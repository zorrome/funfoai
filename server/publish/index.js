function createPublishModule(deps) {
  const { db, withPreviewLink, getPreviewPort, getApiPort } = deps;

  const PUBLISH_STEP_TEMPLATES = [
    { id: 'candidate_prepare', label: '生成 Candidate', visible: true },
    { id: 'candidate_runtime', label: '启动并检查 Candidate 环境', visible: true },
    { id: 'verify', label: '发布验证', visible: true },
    { id: 'completion', label: '发布完成', visible: true },
  ];

  const publishJobsInFlight = new Set();
  const publishCancelRequested = new Set();

  function createPublishSteps() {
    return PUBLISH_STEP_TEMPLATES.map((step, index) => ({
      ...step,
      order: index + 1,
      status: 'pending',
      detail: '',
      updated_at: null,
    }));
  }

  function parsePublishSteps(raw) {
    if (!raw) return createPublishSteps();
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        return createPublishSteps().map(base => {
          const found = parsed.find(item => item && item.id === base.id);
          return found ? { ...base, ...found } : base;
        });
      }
    } catch {}
    return createPublishSteps();
  }

  function getPublishJob(appId) {
    const row = db.prepare('SELECT * FROM publish_jobs WHERE app_id = ?').get(appId);
    if (!row) {
      return {
        app_id: appId,
        status: 'idle',
        current_step: null,
        current_phase: null,
        failure_type: null,
        retryable: null,
        repair_count: 0,
        steps: createPublishSteps(),
        error_message: null,
        started_at: null,
        completed_at: null,
        updated_at: null,
        meta_json: null,
        meta: {},
      };
    }
    return {
      ...row,
      current_phase: row.current_phase || row.current_step || null,
      failure_type: row.failure_type || null,
      retryable: row.retryable == null ? null : !!row.retryable,
      repair_count: Number(row.repair_count || 0),
      steps: parsePublishSteps(row.steps_json),
      meta: (() => { try { return row.meta_json ? JSON.parse(row.meta_json) : {}; } catch { return {}; } })(),
    };
  }

  function savePublishJob(appId, patch = {}) {
    const current = getPublishJob(appId);
    const nextSteps = patch.steps ? patch.steps.map(step => ({ ...step })) : current.steps;
    const nextMeta = patch.meta ? { ...(current.meta || {}), ...(patch.meta || {}) } : (current.meta || {});
    const next = {
      ...current,
      ...patch,
      app_id: appId,
      steps: nextSteps,
      meta: nextMeta,
    };

    try {
      db.prepare(`ALTER TABLE publish_jobs ADD COLUMN current_phase TEXT`).run();
    } catch {}
    try {
      db.prepare(`ALTER TABLE publish_jobs ADD COLUMN failure_type TEXT`).run();
    } catch {}
    try {
      db.prepare(`ALTER TABLE publish_jobs ADD COLUMN retryable INTEGER`).run();
    } catch {}
    try {
      db.prepare(`ALTER TABLE publish_jobs ADD COLUMN repair_count INTEGER DEFAULT 0`).run();
    } catch {}
    try {
      db.prepare(`ALTER TABLE publish_jobs ADD COLUMN meta_json TEXT`).run();
    } catch {}

    db.prepare(`
      INSERT INTO publish_jobs (app_id, status, current_step, current_phase, failure_type, retryable, repair_count, steps_json, error_message, started_at, completed_at, meta_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(app_id) DO UPDATE SET
        status = excluded.status,
        current_step = excluded.current_step,
        current_phase = excluded.current_phase,
        failure_type = excluded.failure_type,
        retryable = excluded.retryable,
        repair_count = excluded.repair_count,
        steps_json = excluded.steps_json,
        error_message = excluded.error_message,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        meta_json = excluded.meta_json,
        updated_at = datetime('now')
    `).run(
      appId,
      next.status || 'idle',
      next.current_step || null,
      next.current_phase || next.current_step || null,
      next.failure_type || null,
      next.retryable == null ? null : (next.retryable ? 1 : 0),
      Number(next.repair_count || 0),
      JSON.stringify(next.steps || createPublishSteps()),
      next.error_message || null,
      next.started_at || null,
      next.completed_at || null,
      JSON.stringify(next.meta || {}),
    );
    return getPublishJob(appId);
  }

  function setPublishStep(appId, stepId, status, detail = '', meta = null) {
    const job = getPublishJob(appId);
    const steps = job.steps.map(step => {
      if (step.id !== stepId) return step;
      return { ...step, status, detail: detail || step.detail || '', updated_at: new Date().toISOString() };
    });
    return savePublishJob(appId, {
      status: status === 'failed' ? 'failed' : (job.status === 'completed' ? 'completed' : 'publishing'),
      current_step: stepId,
      current_phase: stepId,
      error_message: status === 'failed' ? (detail || job.error_message || null) : job.error_message,
      completed_at: status === 'failed' ? new Date().toISOString() : job.completed_at,
      steps,
      ...(meta ? meta : {}),
    });
  }

  function startPublishJobRecord(appId) {
    publishCancelRequested.delete(appId);
    return savePublishJob(appId, {
      status: 'publishing',
      current_step: 'candidate_prepare',
      current_phase: 'candidate_prepare',
      failure_type: null,
      retryable: null,
      repair_count: 0,
      error_message: null,
      started_at: new Date().toISOString(),
      completed_at: null,
      steps: createPublishSteps(),
      meta: { cancel_requested: false },
    });
  }

  function finishPublishJobRecord(appId, status, errorMessage = null, meta = null) {
    const job = getPublishJob(appId);
    let steps = job.steps;
    if (status === 'completed') {
      steps = steps.map(step => step.id === 'completion'
        ? { ...step, status: 'completed', detail: step.detail || '公開環境の準備が完了しました', updated_at: new Date().toISOString() }
        : step);
    } else if (status === 'failed' || status === 'cancelled') {
      const runningStep = steps.find(step => step.status === 'running');
      steps = steps.map(step => {
        if (runningStep && step.id === runningStep.id) {
          return {
            ...step,
            status: status === 'cancelled' ? 'cancelled' : 'failed',
            detail: errorMessage || step.detail || (status === 'cancelled' ? '发布已取消' : '処理に失敗しました'),
            updated_at: new Date().toISOString(),
          };
        }
        if (step.id === 'completion' && step.status === 'pending') {
          return {
            ...step,
            status: status === 'cancelled' ? 'cancelled' : 'failed',
            detail: errorMessage || (status === 'cancelled' ? '发布已取消' : '公開に失敗しました'),
            updated_at: new Date().toISOString(),
          };
        }
        return step;
      });
    }
    return savePublishJob(appId, {
      status,
      current_step: status === 'completed' ? 'completion' : job.current_step,
      current_phase: status === 'completed' ? 'completion' : job.current_phase,
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
      steps,
      ...(meta ? meta : {}),
    });
  }

  function requestPublishCancel(appId) {
    publishCancelRequested.add(appId);
    const job = savePublishJob(appId, {
      meta: {
        cancel_requested: true,
        cancel_requested_at: new Date().toISOString(),
      },
    });
    return job;
  }

  function clearPublishCancel(appId) {
    publishCancelRequested.delete(appId);
    const job = getPublishJob(appId);
    if (job?.meta?.cancel_requested) {
      savePublishJob(appId, {
        meta: {
          cancel_requested: false,
          cancel_requested_at: null,
        },
      });
    }
  }

  function isPublishCancelRequested(appId) {
    if (publishCancelRequested.has(appId)) return true;
    return !!getPublishJob(appId)?.meta?.cancel_requested;
  }

  function buildPublishStatusResponse(appId) {
    const appRow = withPreviewLink(db.prepare('SELECT * FROM apps WHERE id = ?').get(appId));
    if (!appRow) return null;
    const job = getPublishJob(appId);
    const routeFromJob = job?.meta?.publish_route || null;
    const routeFromState = (() => {
      const state = appRow.release_state || 'draft';
      if (state === 'failed') return 'failed_to_candidate';
      if (state === 'rollback') return 'rollback_to_candidate';
      if (state === 'live') return 'live_to_candidate';
      if (state === 'candidate' && appRow.last_failure_reason) return 'failed_to_candidate';
      return 'draft_to_candidate';
    })();
    return {
      ...appRow,
      release_state: appRow.release_state || 'draft',
      publish_route: routeFromJob || routeFromState,
      preview_port: getPreviewPort(appId),
      api_port: getApiPort(appId) ?? appRow.api_port,
      publish_progress: {
        status: job.status,
        current_step: job.current_step,
        current_phase: job.current_phase,
        failure_type: job.failure_type,
        retryable: job.retryable,
        repair_count: job.repair_count,
        error_message: job.error_message,
        started_at: job.started_at,
        completed_at: job.completed_at,
        cancellable: job.status === 'publishing',
        cancel_requested: !!job.meta?.cancel_requested,
        steps: job.steps.filter(step => step.visible !== false),
        meta: job.meta || {},
      },
    };
  }

  return {
    PUBLISH_STEP_TEMPLATES,
    publishJobsInFlight,
    createPublishSteps,
    parsePublishSteps,
    getPublishJob,
    savePublishJob,
    setPublishStep,
    startPublishJobRecord,
    finishPublishJobRecord,
    buildPublishStatusResponse,
    requestPublishCancel,
    clearPublishCancel,
    isPublishCancelRequested,
  };
}

module.exports = { createPublishModule };

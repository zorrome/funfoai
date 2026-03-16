import type { CSSProperties } from 'react';
import { cn } from './ui/utils';

function isImageIcon(icon?: string | null) {
  if (!icon) return false;
  return /^data:image\//.test(icon) || /^https?:\/\//.test(icon) || /^\//.test(icon);
}

type Props = {
  icon?: string | null;
  name?: string;
  className?: string;
  style?: CSSProperties;
  fallback?: string;
  imgClassName?: string;
};

export default function AppIcon({ icon, name, className, style, fallback = '✨', imgClassName }: Props) {
  if (isImageIcon(icon)) {
    return (
      <div className={cn('overflow-hidden', className)} style={style}>
        <img src={icon || ''} alt={name || 'app icon'} className={cn('h-full w-full object-cover', imgClassName)} />
      </div>
    );
  }

  return (
    <div className={className} style={style}>
      {icon || fallback}
    </div>
  );
}

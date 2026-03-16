import { createBrowserRouter } from "react-router";
import VibeCoding from "./pages/VibeCoding";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import Admin from "./pages/Admin";

export const router = createBrowserRouter([
  {
    path: "/login",
    Component: Login,
  },
  {
    path: "/forgot-password",
    Component: ForgotPassword,
  },
  {
    path: "/admin",
    Component: Admin,
  },
  {
    path: "/",
    Component: VibeCoding,
  },
  {
    path: "/market",
    Component: VibeCoding,
  },
  {
    path: "/workspace",
    Component: VibeCoding,
  },
  {
    path: "/workspace/new",
    Component: VibeCoding,
  },
  {
    path: "/workspace/:appId",
    Component: VibeCoding,
  },
  {
    path: "/studio/:workspaceSlug",
    Component: VibeCoding,
  },
  {
    path: "/my-apps",
    Component: VibeCoding,
  },
  {
    path: "/profile",
    Component: VibeCoding,
  },
  {
    path: "/vibe-coding",
    Component: VibeCoding,
  },
]);

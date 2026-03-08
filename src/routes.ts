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
    path: "/vibe-coding",
    Component: VibeCoding,
  },
]);
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" },
      {
        title: "Glove Fight — Punch, Slap, Poke",
      },
      {
        name: "description",
        content:
          "First-person beat-em-up: Rock punches, Paper slaps, Scissors pokes. Desktop, mobile, camera hands, and WebXR VR.",
      },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      // Hint browsers / nested frames that XR is intended (parent iframe may still block)
      {
        httpEquiv: "Permissions-Policy",
        content: "xr-spatial-tracking=*, camera=*, gyroscope=*, accelerometer=*",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootLayout,
});

function RootLayout() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  );
}

import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import appCss from "../styles.css?url";

/** Hostname for absolute share-card URLs. Skip localhost, IPs, and Vercel system hosts. */
function publicShareHost(): string {
  const raw = String(import.meta.env.VITE_PUBLIC_HOSTNAME ?? "").trim();
  const host = raw.split(",")[0]?.trim().split(":")[0]?.toLowerCase() ?? "";
  if (!host || !/^[a-z0-9.-]+$/.test(host) || !host.includes(".")) return "";
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return "";
  if (host === "vercel.app" || host.endsWith(".vercel.app")) return "";
  if (host === "vercel.com" || host.endsWith(".vercel.com")) return "";
  return host;
}

export const Route = createRootRoute({
  head: () => {
    const host = publicShareHost();
    const ogImage = host ? `https://${host}/og.jpg` : "";
    const xBanner = host ? `https://${host}/x-banner.jpg` : "";
    return {
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
        ...(ogImage
          ? [
              { property: "og:image", content: ogImage },
              { property: "og:image:width", content: "1200" },
              { property: "og:image:height", content: "630" },
            ]
          : []),
        ...(xBanner ? [{ property: "x:game:image", content: xBanner }] : []),
      ],
      links: [{ rel: "stylesheet", href: appCss }],
    };
  },
  component: RootLayout,
});

function RootLayout() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-ESG8QE85ZE" />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-ESG8QE85ZE');",
          }}
        />
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

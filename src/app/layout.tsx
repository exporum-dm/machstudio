import type { Metadata, Viewport } from "next";
import { AppAnalytics } from "@/components/layout/app-analytics";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { MotionProvider } from "@/components/motion-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "mach",
  description: "디지털 마케팅팀 협업 플랫폼",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // iOS 노치 대응 (safe-area)
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* 프리-페인트 테마 적용 — 저장된 선택(mach_theme)을 렌더 전에 반영해 깜빡임(FOUC) 방지 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('mach_theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
        <MotionProvider>{children}</MotionProvider>
        <Toaster
          position="top-center"
          className="mach-toaster"
          closeButton
          visibleToasts={3}
          offset={{ top: 18 }}
          mobileOffset={{ top: 12 }}
          toastOptions={{
            style: { borderRadius: "14px", fontSize: "14px" },
            duration: 3000,
          }}
          richColors
        />
        <AppAnalytics />
      </body>
    </html>
  );
}

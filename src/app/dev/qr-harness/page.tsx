"use client";

/** QR 내려받기 하니스 — 개발 환경 전용. PNG 로 다시 그린 QR 이 실제로 읽히는지 jsQR 로 확인한다. */
import { useEffect, useState } from "react";
import { notFound } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import jsQR from "jsqr";
import { renderQrCanvas, serializeQrSvg } from "@/lib/qr-download";

const VALUE = "https://k-expo.org/la?utm_source=meta&utm_medium=cpc&utm_campaign=registration";

export default function QrHarness() {
  const [result, setResult] = useState("checking");
  useEffect(() => {
    void (async () => {
      const svg = document.getElementById("qr-test") as unknown as SVGElement;
      const canvas = await renderQrCanvas(serializeQrSvg(svg));
      if (!canvas) { setResult("no-canvas"); return; }
      const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(data.data, data.width, data.height);
      setResult(JSON.stringify({ width: canvas.width, matches: code?.data === VALUE, decoded: code?.data ?? null }));
    })();
  }, []);
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className="p-6">
      <QRCodeSVG id="qr-test" value={VALUE} size={120} />
      <pre id="result">{result}</pre>
    </div>
  );
}

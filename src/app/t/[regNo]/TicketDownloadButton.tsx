"use client";

import { downloadTicketImage, type TicketImageInput } from "@/lib/collect-form/ticket-image";

export function TicketDownloadButton({ ticket, korean = false }: { ticket: TicketImageInput; korean?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => {
        void downloadTicketImage(ticket).catch(() => {
          window.alert(korean ? "이미지를 저장하지 못했어요. 화면을 캡처해 주세요." : "We couldn't save the ticket image. Please take a screenshot instead.");
        });
      }}
      className="mt-5 block w-full rounded-xl bg-neutral-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-neutral-800 active:scale-[0.99]"
    >
      {korean ? "입장권 이미지 저장" : "Save as Image"}
    </button>
  );
}

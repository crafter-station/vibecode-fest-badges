"use client";

export function PrintButton() {
  return (
    <button
      className="rounded-full border-2 border-stone-950 bg-stone-950 px-4 py-2 font-bold text-white text-xs uppercase tracking-widest transition-colors hover:bg-white hover:text-stone-950"
      onClick={() => window.print()}
      type="button"
    >
      Export PDF
    </button>
  );
}

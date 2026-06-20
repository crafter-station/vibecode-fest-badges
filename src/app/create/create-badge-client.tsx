"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { CreateBadgeState } from "@/lib/web-badge-state";

type CreateBadgeClientProps = {
  initialState: CreateBadgeState;
};

type LocalState = CreateBadgeState | { status: "needs_otp"; email: string };

const maxDimension = 1600;
const maxUploadBytes = 10 * 1024 * 1024;

const formatBadgeNumber = (badgeNumber: number | null) =>
  String(badgeNumber ?? 0).padStart(4, "0");

const readImage = async (file: File) => {
  if ("createImageBitmap" in window) {
    try {
      const bitmap = await createImageBitmap(file);
      return { image: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      // Fall through to the image element path for browsers with partial support.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new window.Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();

    return { image, width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const canvasToWebp = async (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not convert this image to WebP."));
          return;
        }

        resolve(blob);
      },
      "image/webp",
      0.9,
    );
  });

const convertToWebp = async (file: File) => {
  const { image, width, height } = await readImage(file);
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Your browser could not prepare this image.");
  }

  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  if ("close" in image && typeof image.close === "function") {
    image.close();
  }

  const blob = await canvasToWebp(canvas);
  if (blob.size > maxUploadBytes) {
    throw new Error(
      "The converted image is over 10 MB. Choose a smaller photo.",
    );
  }

  return new File([blob], "source-photo.webp", { type: "image/webp" });
};

export function CreateBadgeClient({ initialState }: CreateBadgeClientProps) {
  const [state, setState] = useState<LocalState>(initialState);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (state.status !== "generating") {
      return;
    }

    const interval = window.setInterval(async () => {
      const response = await fetch("/api/create/status");
      if (response.ok) {
        setState((await response.json()) as CreateBadgeState);
      }
    }, 4000);

    return () => window.clearInterval(interval);
  }, [state.status]);

  const requestOtp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch("/api/create/otp/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json()) as { message?: string };

      if (!response.ok) {
        setMessage(data.message ?? "Could not send a code.");
        return;
      }

      setState({ status: "needs_otp", email });
      setMessage(data.message ?? "Check your email for a code.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const verifyOtp = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch("/api/create/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: state.status === "needs_otp" ? state.email : email,
          code,
        }),
      });
      const data = (await response.json()) as { message?: string };

      if (!response.ok) {
        setMessage(data.message ?? "Could not verify that code.");
        return;
      }

      const statusResponse = await fetch("/api/create/status");
      setState((await statusResponse.json()) as CreateBadgeState);
      setMessage(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const uploadPhoto = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("photo");

    if (!(input instanceof HTMLInputElement) || !input.files?.[0]) {
      setMessage("Choose a photo first.");
      return;
    }

    setIsSubmitting(true);
    setMessage("Preparing your photo...");

    try {
      const convertedFile = await convertToWebp(input.files[0]);
      const formData = new FormData();
      formData.set("photo", convertedFile);

      setMessage("Uploading your photo...");
      const response = await fetch("/api/create/upload", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as CreateBadgeState & {
        message?: string;
      };

      if (!response.ok) {
        setMessage(data.message ?? "Could not upload that photo.");
        return;
      }

      setState(data);
      setMessage("Your badge is generating. This can take a few minutes.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not prepare that image.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#f7f0de] px-5 py-8 text-stone-950 sm:px-8 lg:px-12">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="border-stone-950 border-b-4 pb-6">
          <p className="font-mono text-sm uppercase tracking-[0.35em] text-stone-600">
            VCF Badges
          </p>
          <h1 className="mt-2 font-black text-5xl tracking-tight sm:text-7xl">
            Create Badge
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-stone-700">
            Verify your approved Luma email, upload a photo, and generate your
            Vibe Code Fest badge.
          </p>
        </header>

        <section className="rounded-3xl border-4 border-stone-950 bg-white p-6 shadow-[10px_10px_0_#1c1917] sm:p-8">
          {state.status === "needs_email" ? (
            <form className="flex flex-col gap-4" onSubmit={requestOtp}>
              <label className="flex flex-col gap-2 font-bold">
                Luma email
                <input
                  className="rounded-2xl border-4 border-stone-950 px-4 py-3 font-mono text-base"
                  disabled={isSubmitting}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </label>
              <button
                className="rounded-full border-4 border-stone-950 bg-stone-950 px-6 py-3 font-black text-white shadow-[4px_4px_0_#1c1917] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isSubmitting}
                type="submit"
              >
                Send Code
              </button>
            </form>
          ) : null}

          {state.status === "needs_otp" ? (
            <form className="flex flex-col gap-4" onSubmit={verifyOtp}>
              <p className="text-stone-700">
                Enter the 6-digit code sent to {state.email}.
              </p>
              <label className="flex flex-col gap-2 font-bold">
                Verification code
                <input
                  className="rounded-2xl border-4 border-stone-950 px-4 py-3 font-mono text-2xl tracking-[0.4em]"
                  disabled={isSubmitting}
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) =>
                    setCode(event.target.value.replace(/\D/g, ""))
                  }
                  required
                  value={code}
                />
              </label>
              <button
                className="rounded-full border-4 border-stone-950 bg-stone-950 px-6 py-3 font-black text-white shadow-[4px_4px_0_#1c1917] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isSubmitting || code.length !== 6}
                type="submit"
              >
                Verify Code
              </button>
            </form>
          ) : null}

          {state.status === "ready_to_upload" ||
          state.status === "rejected_retry_allowed" ||
          state.status === "failed_retry_allowed" ? (
            <form className="flex flex-col gap-4" onSubmit={uploadPhoto}>
              {state.status === "rejected_retry_allowed" ? (
                <p className="rounded-2xl border-4 border-amber-500 bg-amber-100 p-4 font-bold">
                  That photo could not be used. Choose another clear photo and
                  try again.
                </p>
              ) : null}
              {state.status === "failed_retry_allowed" ? (
                <p className="rounded-2xl border-4 border-red-500 bg-red-100 p-4 font-bold">
                  Generation failed. You can upload again because no badge was
                  completed.
                </p>
              ) : null}
              <label className="flex flex-col gap-2 font-bold">
                Source photo
                <input
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  className="rounded-2xl border-4 border-stone-950 px-4 py-3"
                  disabled={isSubmitting}
                  name="photo"
                  required
                  type="file"
                />
              </label>
              <p className="text-sm text-stone-600">
                Your browser will resize the photo to 1600px max and convert it
                to WebP before upload. Converted uploads must be 10 MB or less.
              </p>
              <button
                className="rounded-full border-4 border-stone-950 bg-stone-950 px-6 py-3 font-black text-white shadow-[4px_4px_0_#1c1917] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isSubmitting}
                type="submit"
              >
                Generate Badge
              </button>
            </form>
          ) : null}

          {state.status === "generating" ? (
            <div className="flex flex-col gap-4">
              <p className="font-black text-3xl">Generating...</p>
              <p className="text-stone-700">
                Badge #{formatBadgeNumber(state.badgeNumber)} is in progress.
                This page will update automatically.
              </p>
            </div>
          ) : null}

          {state.status === "completed" ? (
            <div className="flex flex-col gap-5">
              <div>
                <p className="font-mono text-sm uppercase tracking-[0.3em] text-stone-600">
                  Badge #{formatBadgeNumber(state.badgeNumber)}
                </p>
                <h2 className="mt-1 font-black text-4xl">
                  Your badge is ready.
                </h2>
              </div>
              <Image
                alt={`Badge #${formatBadgeNumber(state.badgeNumber)}`}
                className="w-full rounded-2xl border-4 border-stone-950"
                height={1350}
                src={state.badgeImageUrl}
                unoptimized
                width={1080}
              />
              <div className="flex flex-wrap gap-3">
                <a
                  className="rounded-full border-4 border-stone-950 bg-stone-950 px-6 py-3 font-black text-white shadow-[4px_4px_0_#1c1917]"
                  href={state.badgeImageUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open Badge
                </a>
                <a
                  className="rounded-full border-4 border-stone-950 bg-white px-6 py-3 font-black shadow-[4px_4px_0_#1c1917]"
                  download={`vcf-badge-${formatBadgeNumber(state.badgeNumber)}.png`}
                  href={state.badgeImageUrl}
                >
                  Download
                </a>
              </div>
            </div>
          ) : null}

          {message ? (
            <p className="mt-5 text-sm text-stone-700">{message}</p>
          ) : null}
        </section>
      </div>
    </main>
  );
}

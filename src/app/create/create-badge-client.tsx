"use client";

import Image from "next/image";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useState,
} from "react";

type BadgeRequest = {
  status: string;
  error: string | null;
  badgeNumber: number | null;
  badgeImageUrl: string | null;
  canUpload: boolean;
};

type StatusResponse = {
  authenticated: boolean;
  email?: string;
  request: BadgeRequest | null;
};

const resizeImage = async (file: File) => {
  let bitmap: ImageBitmap;

  try {
    bitmap = await createImageBitmap(file);
  } catch {
    const isHeic =
      file.type === "image/heic" ||
      file.type === "image/heif" ||
      /\.hei[cf]$/i.test(file.name);

    throw new Error(
      isHeic
        ? "This browser cannot decode that HEIC photo. Try JPG, PNG, WebP, or a HEIC-capable browser."
        : "This browser could not read that image. Try JPG, PNG, or WebP.",
    );
  }

  const longestSide = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, 1600 / longestSide);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Your browser cannot process this image.");
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.9),
  );

  if (!blob) {
    throw new Error("Your browser could not export the image as WebP.");
  }

  return new File([blob], "vcf-badge-source.webp", { type: "image/webp" });
};

export function CreateBadgeClient() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [phase, setPhase] = useState<"email" | "otp" | "upload">("email");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    const response = await fetch("/api/create/status", { cache: "no-store" });
    const data = (await response.json()) as StatusResponse;
    setStatus(data);

    if (data.authenticated) {
      setPhase("upload");
      setEmail(data.email ?? email);
    }
  }, [email]);

  const sendOtp = async () => {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/create/otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not send code.");
      }

      setPhase("otp");
      setMessage("Code sent. Check the email you used for Luma registration.");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not send code.",
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (status?.request?.status !== "generating") {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshStatus();
    }, 3500);

    return () => window.clearInterval(interval);
  }, [refreshStatus, status?.request?.status]);

  const requestOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await sendOtp();
  };

  const verifyOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/create/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not verify code.");
      }

      setPhase("upload");
      setMessage("Verified. Upload the photo you want on your Badge.");
      await refreshStatus();
    } catch (verifyError) {
      setError(
        verifyError instanceof Error
          ? verifyError.message
          : "Could not verify code.",
      );
    } finally {
      setBusy(false);
    }
  };

  const uploadPhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("Optimizing your photo in the browser...");

    try {
      const processedFile = await resizeImage(file);
      const formData = new FormData();
      formData.set("file", processedFile);

      setMessage("Uploading and starting Badge generation...");
      const response = await fetch("/api/create/upload", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Could not upload photo.");
      }

      setMessage("Generation started. This can take a few minutes.");
      await refreshStatus();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not upload photo.",
      );
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  };

  const request = status?.request;
  const generated = request?.status === "generated" && request.badgeImageUrl;
  const showUpload =
    phase === "upload" &&
    (!request || request.canUpload || request.status === "pending");

  return (
    <main className="min-h-screen bg-[#f7f0de] px-5 py-8 text-stone-950 sm:px-8 lg:px-12">
      <div className="mx-auto grid w-full max-w-6xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <header className="rounded-[2rem] border-4 border-stone-950 bg-[#ffcf33] p-8 shadow-[10px_10px_0_#1c1917]">
          <p className="font-mono text-sm uppercase tracking-[0.35em] text-stone-700">
            VCF Badges
          </p>
          <h1 className="mt-4 font-black text-5xl tracking-tight sm:text-7xl">
            Create your Badge
          </h1>
          <p className="mt-5 text-lg text-stone-800 leading-8">
            Use the email you registered with on Luma. Approved participants get
            one web Badge, downloadable here after generation finishes.
          </p>
        </header>

        <section className="rounded-[2rem] border-4 border-stone-950 bg-white p-6 shadow-[10px_10px_0_#1c1917] sm:p-8">
          {phase === "email" ? (
            <form className="flex flex-col gap-4" onSubmit={requestOtp}>
              <label className="font-black text-2xl" htmlFor="email">
                Luma email
              </label>
              <input
                autoComplete="email"
                className="rounded-2xl border-4 border-stone-950 px-4 py-3 text-lg outline-none focus:bg-[#fff6d8]"
                id="email"
                inputMode="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                type="email"
                value={email}
              />
              <button
                className="rounded-full border-4 border-stone-950 bg-stone-950 px-6 py-4 font-black text-white shadow-[5px_5px_0_#facc15] disabled:opacity-50"
                disabled={busy}
                type="submit"
              >
                Send code
              </button>
            </form>
          ) : null}

          {phase === "otp" ? (
            <form className="flex flex-col gap-4" onSubmit={verifyOtp}>
              <label className="font-black text-2xl" htmlFor="code">
                Enter your 6-digit code
              </label>
              <input
                autoComplete="one-time-code"
                className="rounded-2xl border-4 border-stone-950 px-4 py-3 text-center font-mono text-3xl tracking-[0.4em] outline-none focus:bg-[#fff6d8]"
                id="code"
                inputMode="numeric"
                maxLength={6}
                onChange={(event) => setCode(event.target.value)}
                pattern="[0-9]{6}"
                required
                value={code}
              />
              <div className="flex flex-wrap gap-3">
                <button
                  className="rounded-full border-4 border-stone-950 bg-stone-950 px-6 py-4 font-black text-white shadow-[5px_5px_0_#facc15] disabled:opacity-50"
                  disabled={busy}
                  type="submit"
                >
                  Verify
                </button>
                <button
                  className="rounded-full border-4 border-stone-950 bg-white px-6 py-4 font-black shadow-[5px_5px_0_#1c1917] disabled:opacity-50"
                  disabled={busy}
                  onClick={() => void sendOtp()}
                  type="button"
                >
                  Send new code
                </button>
              </div>
            </form>
          ) : null}

          {phase === "upload" ? (
            <div className="flex flex-col gap-5">
              <div>
                <p className="font-mono text-sm uppercase tracking-[0.25em] text-stone-600">
                  Signed in as
                </p>
                <p className="mt-1 font-black text-2xl">{email}</p>
              </div>

              {generated ? (
                <div className="flex flex-col gap-5">
                  <div className="overflow-hidden rounded-3xl border-4 border-stone-950 bg-[#f7f0de] p-3">
                    <Image
                      alt={`Badge #${String(request.badgeNumber ?? 0).padStart(4, "0")}`}
                      className="h-auto w-full rounded-2xl"
                      height={1350}
                      src={request.badgeImageUrl ?? ""}
                      unoptimized
                      width={1080}
                    />
                  </div>
                  <a
                    className="rounded-full border-4 border-stone-950 bg-[#ff5c39] px-6 py-4 text-center font-black text-white shadow-[5px_5px_0_#1c1917]"
                    download
                    href={request.badgeImageUrl ?? ""}
                  >
                    Download Badge #
                    {String(request.badgeNumber ?? 0).padStart(4, "0")}
                  </a>
                </div>
              ) : null}

              {request?.status === "generating" ? (
                <div className="rounded-3xl border-4 border-stone-950 bg-[#d7f35f] p-5 font-black text-xl">
                  Your Badge is generating. Keep this tab open or come back
                  later; your session lasts 7 days.
                </div>
              ) : null}

              {request?.status === "rejected" ? (
                <div className="rounded-3xl border-4 border-stone-950 bg-[#ffe0dc] p-5">
                  <h2 className="font-black text-xl">Try another photo</h2>
                  <p className="mt-2 text-stone-700">
                    That image could not be used. Upload a clear photo of
                    yourself to use your Badge allocation.
                  </p>
                </div>
              ) : null}

              {showUpload ? (
                <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-3xl border-4 border-dashed border-stone-950 bg-[#fff6d8] p-8 text-center transition-colors hover:bg-[#ffefad]">
                  <span className="font-black text-2xl">Upload photo</span>
                  <span className="max-w-md text-stone-700">
                    JPG, PNG, WebP, or browser-decodable HEIC. The browser will
                    resize it to about 1600px and convert it to WebP before
                    upload.
                  </span>
                  <input
                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                    className="sr-only"
                    disabled={busy}
                    onChange={uploadPhoto}
                    type="file"
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          {message ? (
            <p className="mt-5 rounded-2xl border-2 border-stone-950 bg-[#d7f35f] p-4 font-bold">
              {message}
            </p>
          ) : null}
          {error || request?.error ? (
            <p className="mt-5 rounded-2xl border-2 border-stone-950 bg-[#ffe0dc] p-4 font-bold text-stone-900">
              {error || request?.error}
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}

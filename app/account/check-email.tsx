"use client";

import { useEffect, useRef, useState } from "react";
import type { AccountType } from "./onboarding";

export type PendingVerification = {
  email: string;
  accountType: AccountType;
  requestedAt: number;
};

export function CheckEmail({ pending, onResend, onCheck, onEditEmail, onSignIn }: {
  pending: PendingVerification;
  onResend: () => Promise<void>;
  onCheck: () => Promise<boolean>;
  onEditEmail: () => void;
  onSignIn: () => void;
}) {
  const [resendAt, setResendAt] = useState(pending.requestedAt + 60_000);
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
  const [busy, setBusy] = useState<"resend" | "check" | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState(false);
  const working = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const seconds = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
      setRemaining(seconds);
      if (seconds === 0) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  async function act(action: "resend" | "check") {
    if (working.current || (action === "resend" && Date.now() < resendAt)) return;
    working.current = true; setBusy(action); setFeedback(""); setError(false);
    try {
      if (action === "resend") {
        // Backoff applies to failed attempts too; provider-side limits remain authoritative.
        setResendAt(Date.now() + 60_000); setRemaining(60);
        await onResend();
        setFeedback("Another verification email has been requested. Allow a few minutes, then use the newest link in your inbox.");
      } else if (!await onCheck()) {
        setFeedback("We haven’t detected a verified sign-in here yet. Open the verification link in your email first. If you verified in another browser or on another device, choose Sign in below.");
      }
    } catch (failure) {
      setError(true);
      const code = typeof failure === "object" && failure !== null && "code" in failure ? String(failure.code) : "";
      const rateLimited = code === "over_email_send_rate_limit" || code === "over_request_rate_limit";
      setFeedback(rateLimited ? "Too many email requests. Please wait a few minutes before trying again, and check your spam folder."
        : action === "resend" ? "We couldn’t request another email right now. Please wait a few minutes and try again. You can still use the last verification email you received."
        : "We couldn’t check your verification right now. Please check your connection and try again.");
    } finally { working.current = false; setBusy(null); }
  }

  return <section className="portalPanel emailVerification" aria-labelledby="check-email-title">
    <div className="verificationIcon" aria-hidden="true"><svg width="32" height="32" viewBox="0 0 32 32" fill="none"><rect x="3" y="6" width="26" height="20" rx="3" stroke="currentColor" strokeWidth="1.5"/><path d="m4 8 12 9L28 8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg></div>
    <p className="eyebrow">VERIFY YOUR EMAIL · {pending.accountType.toUpperCase()} ACCOUNT</p>
    <h1 id="check-email-title" tabIndex={-1} ref={heading}>Check your inbox</h1>
    <p className="verificationIntro">You’re one step closer. Look for an Irkanti verification email at</p>
    <p className="verificationAddress">{pending.email}</p>
    <button type="button" className="verificationTextButton" disabled={!!busy} onClick={onEditEmail}>Wrong email address? Correct it</button>

    <ol className="verificationSteps">
      <li><strong>Open the email from Irkanti</strong><span>Check your inbox, and your spam or junk folder if you don’t see it.</span></li>
      <li><strong>Follow the verification link</strong><span>This confirms your email address and brings you back to Irkanti.</span></li>
      <li><strong>Complete your buyer profile</strong><span>Choose your interests and submit your ID for review before bidding.</span></li>
    </ol>

    <div className="verificationActions">
      <button type="button" className="goldButton" disabled={!!busy} onClick={() => void act("check")}>{busy === "check" ? "Checking verification…" : "I’ve verified my email"}</button>
      <button type="button" disabled={!!busy || remaining > 0} onClick={() => void act("resend")}>{busy === "resend" ? "Requesting email…" : remaining > 0 ? `Resend email in ${remaining}s` : "Resend verification email"}</button>
    </div>
    {feedback && <p className="portalMessage verificationFeedback" role={error ? "alert" : "status"}>{feedback}</p>}
    <div className="verificationHelp"><h2>No email yet?</h2><p>Allow a few minutes for it to arrive. Check the address above and your spam folder, then request a new email if needed. If you already have an account, sign in instead.</p></div>
    <p className="verificationSignIn">Already verified? <button type="button" className="verificationTextButton" disabled={!!busy} onClick={onSignIn}>Sign in →</button></p>
    <p className="muted verificationPrivacy">Email verification confirms your address. Your identity is reviewed separately before bidding.</p>
  </section>;
}

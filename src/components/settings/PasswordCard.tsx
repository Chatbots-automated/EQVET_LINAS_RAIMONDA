"use client";

import { useState } from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { changePasswordAction } from "@/app/(app)/settings/account/actions";

const MIN_LENGTH = 10;

/** "Change my own password" — the rules shown here are enforced again on the server. */
export function PasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const rules = [
    { ok: next.length >= MIN_LENGTH, text: `Bent ${MIN_LENGTH} simbolių` },
    { ok: /\p{L}/u.test(next) && /\d/.test(next), text: "Bent viena raidė ir vienas skaičius" },
    { ok: next.length > 0 && next !== current, text: "Skiriasi nuo dabartinio" },
    { ok: next.length > 0 && next === repeat, text: "Pakartotas vienodai" },
  ];
  const valid = current.length > 0 && rules.every((r) => r.ok);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setNotice(null);
    const res = await changePasswordAction({ currentPassword: current, newPassword: next });
    setSaving(false);
    if (!res.ok) return setNotice({ tone: "error", text: res.error });
    setCurrent("");
    setNext("");
    setRepeat("");
    setNotice({ tone: "ok", text: "Slaptažodis pakeistas. Kituose įrenginiuose ši paskyra atjungta." });
  }

  const type = show ? "text" : "password";

  return (
    <Card title="Slaptažodis" titleIcon={<KeyRound size={16} className="text-slate-500" />} className="mt-6 max-w-3xl">
      <form onSubmit={submit} className="space-y-3">
        <Input
          label="Dabartinis slaptažodis"
          type={type}
          required
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Naujas slaptažodis"
            type={type}
            required
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <Input
            label="Pakartokite naują slaptažodį"
            type={type}
            required
            autoComplete="new-password"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          />
        </div>

        <ul className="grid gap-1 text-xs sm:grid-cols-2">
          {rules.map((r) => (
            <li key={r.text} className={r.ok ? "text-emerald-700" : "text-slate-500"}>
              {r.ok ? "✓" : "○"} {r.text}
            </li>
          ))}
        </ul>

        {notice && (
          <p className={`rounded-lg px-3 py-2 text-sm ${notice.tone === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
            {notice.text}
          </p>
        )}

        <div className="flex items-center justify-between pt-1">
          <button type="button" onClick={() => setShow((v) => !v)} className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700">
            {show ? <EyeOff size={14} /> : <Eye size={14} />} {show ? "Slėpti slaptažodžius" : "Rodyti slaptažodžius"}
          </button>
          <Button type="submit" disabled={!valid || saving}>
            {saving ? "Keičiama..." : "Pakeisti slaptažodį"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

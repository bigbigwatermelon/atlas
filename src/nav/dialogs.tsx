import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent } from "../components/ui/Dialog";
import { Button } from "../components/ui/Button";
import { Input, Field } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { useStore } from "../state/store";

export function CreateThreadDialog({ open, onOpenChange }: DProps) {
  const { createThread } = useStore();
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState("feature");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    if (!title.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await createThread(title.trim(), kind);
      setTitle("");
      onOpenChange(false);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t("dialog.newTaskTitle")}
        description={t("dialog.newTaskDesc")}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-4"
        >
          <Field label={t("dialog.taskTitle")}>
            <Input
              autoFocus
              placeholder={t("dialog.taskTitleHint")}
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
            />
          </Field>
          <Field label={t("dialog.threadType")}>
            <Select
              value={kind}
              onValueChange={setKind}
              ariaLabel={t("dialog.threadType")}
              options={[
                { value: "feature", label: t("kind.feature") },
                { value: "bugfix", label: t("kind.bugfix") },
                { value: "refactor", label: t("kind.refactor") },
                { value: "spike", label: t("kind.spike") },
              ]}
            />
          </Field>
          {err && <p className="text-[12px] text-danger">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={!title.trim() || busy}>
              {busy ? t("dialog.creating") : t("dialog.createTask")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RenameDialog({
  open,
  onOpenChange,
  title,
  label,
  initial,
  onSubmit,
}: DProps & {
  title: string;
  label: string;
  initial: string;
  onSubmit: (value: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Seed `value` only on the false→true edge so an external refresh that
  // changes `initial` while the dialog is open doesn't clobber what the user
  // is typing. We read the latest `initial` via a ref to avoid stale closures.
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      setValue(initialRef.current);
      setBusy(false);
      setErr(null);
    }
    wasOpen.current = open;
  }, [open]);

  async function submit() {
    const v = value.trim();
    if (!v || busy) return;
    if (v === initial.trim()) {
      onOpenChange(false);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSubmit(v);
      onOpenChange(false);
    } catch (e) {
      const raw = String(e);
      // Backend uses anyhow::bail!("…cannot be empty") / "…already" for the
      // two known rejections — translate them; fall back to a generic message
      // (the raw Rust string is logged for debugging, not shown).
      if (/empty/i.test(raw)) setErr(t("error.renameEmpty"));
      else if (/already/i.test(raw)) setErr(t("error.renameDuplicate"));
      else setErr(t("error.renameFailed"));
      if (import.meta.env.DEV) console.error("rename failed:", raw);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-4"
        >
          <Field label={label}>
            <Input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.currentTarget.value)}
              onFocus={(e) => e.currentTarget.select()}
            />
          </Field>
          {err && <p className="text-[12px] text-danger">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={!value.trim() || busy}>
              {busy ? t("dialog.renaming") : t("common.rename")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface DProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

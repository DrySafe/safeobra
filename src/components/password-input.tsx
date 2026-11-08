"use client";
import { useState } from "react";

export function PasswordInput({
  id,
  name,
  defaultValue = "",
  autoComplete,
  required,
}: {
  id: string;
  name: string;
  defaultValue?: string;
  autoComplete: "new-password" | "current-password";
  required: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        defaultValue={defaultValue}
        autoComplete={autoComplete}
        minLength={6}
        maxLength={128}
        required={required}
      />
      <button
        type="button"
        className="secondary"
        aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
        aria-controls={id}
        aria-pressed={visible}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? "Ocultar" : "Mostrar"}
      </button>
    </div>
  );
}

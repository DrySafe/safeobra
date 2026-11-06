/** Safe messages only: never return provider error text or request data to clients. */
export type AuthFailure = { code?: string; status?: number; message?: string };
export function authErrorMessage(
  operation: "signup" | "login",
  error: AuthFailure,
): string {
  const code = error.code;
  if (operation === "signup") {
    if (
      code === "over_email_send_rate_limit" ||
      (error.status === 429 &&
        /email rate limit exceeded/i.test(error.message ?? ""))
    ) {
      return "O limite de envio de e-mails de confirmação foi atingido. Aguarde antes de tentar novamente ou avise o responsável pelo sistema.";
    }
    if (
      code === "email_address_not_authorized" ||
      /error sending confirmation email/i.test(error.message ?? "")
    ) {
      return "Não conseguimos enviar o e-mail de confirmação para este endereço agora. Avise o responsável pelo sistema.";
    }
    if (code === "email_address_invalid" || code === "validation_failed") {
      return "Confira se o e-mail informado é válido.";
    }
    if (code === "weak_password") {
      return "A senha não atende à política de segurança. Escolha uma senha mais forte.";
    }
  } else if (code === "email_not_confirmed") {
    return "Confirme seu e-mail antes de entrar. Verifique também a pasta de spam.";
  }
  if (error.status === 429 || code === "over_request_rate_limit") {
    return "Muitas tentativas em pouco tempo. Aguarde antes de tentar novamente.";
  }
  return operation === "signup"
    ? "Não foi possível cadastrar agora. Tente novamente mais tarde ou avise o responsável pelo sistema."
    : "E-mail ou senha inválidos, ou e-mail não confirmado.";
}

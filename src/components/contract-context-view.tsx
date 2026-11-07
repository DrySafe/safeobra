import type { ContractContext } from "@/lib/contract-context";
import { money } from "@/lib/finance";
export function ContractContextView({
  context: c,
}: {
  context: ContractContext;
}) {
  return (
    <section className="panel">
      <h3>Comparação com a empreitada</h3>
      <div className="cards estimate-cards">
        <article className="card">
          <span className="small muted">
            Total contratado + extras aprovados
          </span>
          <div className="value">{money(c.valor_total)}</div>
          <span className="small muted">
            Original {money(c.valor_original)} · extras{" "}
            {money(c.extras_aprovados)}
          </span>
        </article>
        <article className="card">
          <span className="small muted">Devido até agora na empreitada</span>
          <div className="value">{money(c.devido_agora)}</div>
          <span className="small muted">
            Pelo executado, descontando pagamentos e descontos reais
          </span>
        </article>
        <article className="card">
          <span className="small muted">Falta concluir</span>
          <div className="value">
            {c.percentual_restante === null
              ? "A completar plano"
              : c.percentual_restante.toFixed(1) + "%"}
          </div>
        </article>
      </div>
      {c.saldo_a_distribuir > 0 && (
        <p className="notice">
          Há {money(c.saldo_a_distribuir)} já pagos/quitados no contrato
          aguardando distribuição por serviço. Eles já reduzem o saldo geral.
        </p>
      )}
      {c.item ? (
        <>
          <h3>
            {c.item.nome} ·{" "}
            {c.item.classe === "extra"
              ? "Extra" + (c.item.aprovado ? " aprovado" : " a aprovar")
              : "Incluído no preço"}
          </h3>
          <p>
            Valor combinado/alocado:{" "}
            {c.item.valor_cobrado === null
              ? "a definir"
              : money(c.item.valor_cobrado)}
            . Execução: {c.item.percentual_executado}%.
          </p>
          <p>
            Referência de mercado para o serviço completo:{" "}
            {c.item.mercado_total === null
              ? "faltam preços ou medidas"
              : money(c.item.mercado_total)}
            . Para a parte executada:{" "}
            {c.item.mercado_executado === null
              ? "a calcular"
              : money(c.item.mercado_executado)}
            .
          </p>
          <p>
            Pago vinculado: {money(c.item.pago_vinculado)} · descontos:{" "}
            {money(c.item.desconto_vinculado)} · devido ao item pelo executado:{" "}
            {money(c.item.devido_executado)}.
          </p>
          <p className="small muted">
            O valor devido respeita a parcela do preço combinado e o avanço
            registrado. A pesquisa de mercado serve para comparar e negociar;
            não altera o contrato nem determina desconto automático. Confira se
            a descrição pesquisada corresponde ao serviço selecionado.
          </p>
        </>
      ) : (
        <p className="small muted">
          Selecione um serviço para comparar a sua parcela. Uma pesquisa isolada
          não deve ser confundida com o preço da empreitada inteira.
        </p>
      )}
    </section>
  );
}

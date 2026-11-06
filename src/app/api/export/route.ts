import { NextResponse } from "next/server";
import { access } from "@/server/access";
import { z } from "zod";
import { id, categories } from "@/lib/schemas";
import { csv } from "@/lib/finance";
const filters = z.object({
  obra: id,
  busca: z.string().max(300).optional(),
  categoria: z.enum(categories).optional(),
  status: z.enum(["pendente", "entregue"]).optional(),
  inicio: z.iso.date().optional(),
  fim: z.iso.date().optional(),
});
export async function GET(request: Request) {
  try {
    const params = Object.fromEntries(
      [...new URL(request.url).searchParams].filter(([, v]) => v !== ""),
    );
    const f = filters.parse(params);
    const { client } = await access(f.obra);
    const rows: unknown[][] = [
      [
        "Categoria",
        "Descrição",
        "Fornecedor",
        "Quantidade",
        "Unitário (R$)",
        "Total (R$)",
        "Data compra",
        "Data entrega",
        "Pagamento",
        "Status",
      ],
    ];
    for (let from = 0; ; from += 1000) {
      let query = client
        .from("gastos")
        .select("*")
        .eq("obra_id", f.obra)
        .order("id")
        .range(from, from + 999);
      if (f.categoria) query = query.eq("categoria", f.categoria);
      if (f.status) query = query.eq("status_entrega", f.status);
      if (f.inicio) query = query.gte("data_compra", f.inicio);
      if (f.fim) query = query.lte("data_compra", f.fim);
      const { data, error } = await query;
      if (error) throw error;
      for (const e of data) {
        if (
          f.busca &&
          !`${e.descricao} ${e.fornecedor}`
            .toLocaleLowerCase("pt-BR")
            .includes(f.busca.toLocaleLowerCase("pt-BR"))
        )
          continue;
        rows.push([
          e.categoria,
          e.descricao,
          e.fornecedor,
          e.quantidade,
          (e.valor_unitario / 100).toFixed(2).replace(".", ","),
          (e.valor_total / 100).toFixed(2).replace(".", ","),
          e.data_compra.split("-").reverse().join("/"),
          e.data_entrega?.split("-").reverse().join("/"),
          e.forma_pagamento,
          e.status_entrega,
        ]);
      }
      if (data.length < 1000) break;
    }
    return new Response(csv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="gastos.csv"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível exportar" },
      { status: 400 },
    );
  }
}

export type Base = {
  id: string;
  obra_id: string;
  criado_em: string;
  criado_por: string;
};
export type Expense = Base & {
  categoria: string;
  descricao: string;
  fornecedor: string;
  quantidade: number;
  valor_unitario: number;
  valor_total: number;
  data_compra: string;
  data_entrega: string | null;
  forma_pagamento: string;
  observacoes: string;
  status_entrega: string;
};
export type Contract = Base & {
  tipo: string;
  profissional: string;
  valor_geral: number;
  plano_ativo: boolean;
};
export type Stage = Base & {
  contrato_id: string;
  nome: string;
  descricao: string;
  categoria: string;
  peso: number;
  unidade: import("./estimates").ServiceUnit;
  quantidade: number;
  percentual_executado: number;
  status: string;
};
export type Payment = Base & {
  contrato_id: string;
  anulado: boolean;
  servico_id: string | null;
  data: string;
  valor_bruto: number;
  desconto: number;
  valor: number;
  referencia: string;
  forma_pagamento: string;
  modo: string;
};
export type Discount = Base & {
  contrato_id: string;
  descricao: string;
  valor: number;
  aplicado: number;
  aplicacao: string;
};
export type Occurrence = Base & {
  titulo: string;
  descricao: string;
  tipo: string;
  data: string;
  servico_id: string | null;
  status: string;
  responsavel: string;
};
export type Attachment = Base & {
  entidade: string;
  entidade_id: string;
  mime: string;
  tamanho: number;
};
export type Execution = Base & {
  servico_id: string;
  data: string;
  percentual: number;
  observacoes: string;
};
export type Invite = {
  id: string;
  role: string;
  expira_em: string;
  usado_em: string | null;
  revogado: boolean;
};
export type Audit = {
  id: number;
  tabela: string;
  acao: string;
  user_id: string;
  criado_em: string;
};

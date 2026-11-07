# SafeObra

Controle de obra em pt-BR, com Next.js App Router, TypeScript, Tailwind e Supabase. Valores persistidos em **centavos**, pesos em pontos-base (10.000 = 100%) e datas civis no fuso `America/Maceio`.

## Executar

Use Node.js 24 e npm. Este checkout já é isolado: trabalhe nele, sem criar worktrees.

```sh
npm ci
cp .env.example .env.local
# Preencha .env.local com as configurações do seu próprio projeto.
npm run dev
```

As variáveis do exemplo estão intencionalmente vazias:

| Variável                    | Uso                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------ |
| `SUPABASE_URL`              | URL HTTPS do projeto Supabase                                                                    |
| `SUPABASE_ANON_KEY`         | Chave anon usada apenas pelo servidor; a proteção dos dados é RLS                                |
| `SUPABASE_SERVICE_ROLE_KEY` | Exclusivamente servidor: rate limit e upload validado; nunca exponha no navegador                |
| `APP_URL`                   | Origem canônica da aplicação, sem barra final; usada em callback, convites e validação de origem |
| `RATE_LIMIT_SALT`           | Segredo aleatório de pelo menos 32 bytes, usado para anonimizar as chaves do rate limit          |

Gere `RATE_LIMIT_SALT` localmente com um gerenciador de segredos. Não use valores de exemplo como credenciais. Configure os valores na Vercel ou no ambiente seguro; não os envie pelo chat, não os coloque no README ou no Git. Nenhum segredo é necessário para os testes locais isolados.

Todas as variáveis do app são consumidas no servidor. Na Vercel, cadastre `SUPABASE_URL` e `SUPABASE_ANON_KEY` sem o prefixo `NEXT_PUBLIC_`. Os nomes legados são aceitos somente como compatibilidade com ambientes existentes; não são necessários no deploy.

## Configurar Supabase

1. Crie um projeto Supabase e aplique, **em ordem**, todos os arquivos de `supabase/migrations/` no SQL Editor ou pelo Supabase CLI (`supabase link`, `supabase db push`). Não execute migrations de teste no banco de produção.
2. Em Authentication → Providers, habilite e-mail/senha e **confirmação de e-mail**. Configure SMTP de produção. O app não habilita Google OAuth nesta versão (opcional no escopo).
3. Em URL Configuration, informe `APP_URL` como Site URL e permita exatamente `APP_URL/auth/callback` como redirect. Em desenvolvimento, adicione a origem local usada no seu `.env.local`.
4. Configure os cinco nomes de variáveis acima. A service role fica apenas no servidor. Nenhuma operação administrativa é feita com ela antes da verificação de sessão/permissão, exceto o rate limit anônimo de autenticação.
5. Reinicie a aplicação. Crie uma conta, confirme o e-mail e crie a primeira obra; o criador vira ADM automaticamente. Convites aceitos exigem e-mail confirmado também no banco.
6. O bucket `obra-anexos` é criado **privado** pela migration. Não crie policies públicas de escrita: o endpoint de servidor verifica os bytes e grava com a service role; os metadados usam a sessão e RLS. Downloads usam a sessão normal e URLs de 60 segundos.

## Cadastro e envio de confirmação

O cadastro mantém a confirmação de e-mail obrigatória. Configure um **SMTP próprio** em [Supabase → Authentication → SMTP](https://supabase.com/dashboard/project/kjryjmuauloebjvbcvqx/auth/smtp): host, porta, usuário, senha e remetente verificado do seu provedor. Não grave esses valores neste arquivo ou no Git.

O serviço de e-mail padrão do Supabase tem restrição de destinatários e cota reduzida (o projeto estava configurado com 2 envios por hora). O erro `over_email_send_rate_limit`/HTTP 429 impede o envio de confirmação e precisa ser resolvido na configuração de e-mail. Aumentar o limite do app ou desativar a confirmação não resolve a configuração de entrega.

As Server Actions do Next.js podem responder HTTP 200 mesmo quando a operação retorna `{ ok: false }`. A interface mostra a mensagem da operação; o status HTTP isolado não confirma que o cadastro foi concluído. Falhas do provedor são registradas no servidor apenas com operação, código e status, sem e-mail, senha, token ou mensagem bruta.

## Uso no celular, notas e estimativas

- No celular, o cabeçalho mostra a obra e um menu hambúrguer. O menu reúne os módulos, tema e saída; fecha com toque fora ou Escape. No desktop, o menu lateral continua disponível.
- A barra animada acompanha navegação, filtros, ações e uploads. Quem prefere movimento reduzido recebe uma barra estática. Cada módulo busca apenas os dados necessários: Gastos lê gastos/anexos; Equipe e convites não lê os oito livros financeiros; a sessão é reaproveitada somente dentro de cada requisição.
- Em **Gastos → Adicionar gasto**, escolha fotos, PDF ou XML antes de salvar. Os anexos são enviados após a gravação do gasto. Se houver falha, use **Reenviar notas pendentes**, **Substituir notas pendentes** ou **Enviar depois**. Reenviar não cria outro gasto. Em cada lançamento, **Enviar nota fiscal / ver comprovantes** permite continuar depois. O limite continua 4 MiB por arquivo, com validação de bytes no servidor e Storage privado.
- **Estimativa de serviços → Pesquisar preço na internet** usa OpenAI com busca web, sem exigir base cadastrada. Informe serviço, região e o que o preço deve incluir. A resposta apresenta fontes clicáveis, trechos de preços publicados, faixa e média indicativa. A calculadora com cotações da própria obra permanece opcional.
- Antes de ativar uma empreitada, informe a **unidade de medição** e a **quantidade prevista** de cada serviço. Depois de ativado, pesos e medições ficam fixos para preservar o histórico. Etapas antigas recebem unidade `serviço` e quantidade 1; não são convertidas artificialmente em m².
- A estimativa é informativa: não muda o valor contratado, execução financeira ou pagamentos. A pesquisa web prioriza fontes locais/estaduais e identifica quando usa valores nacionais. Sem preço publicado comparável, informa a ausência de resultado. A base manual continua disponível para cotações e composições de custos próprias.

## Regras financeiras

- Gasto: quantidade × valor unitário, arredondado para centavos pelo PostgreSQL. O total não é fornecido pelo navegador.
- Empreitada: cadastre serviços com pesos cuja soma seja 100%, depois ative o plano. Os pesos ficam fixos quando ativo para preservar o significado dos avanços históricos.
- Execução: percentual **acumulado**, entre 0 e 100, sem regressão. O histórico preserva data, autor e observações. Devido = soma do valor de cada serviço × execução; o arredondamento do total acontece uma vez.
- Adiantamentos por serviço são permitidos mesmo antes de 100%, conforme decisão do usuário. Pagamentos não podem quitar mais que o valor contratado. A interface distingue adiantamento de valor executado.
- Diária/avulso: cadastre uma contratação com o teto acordado e registre os pagamentos semanais/avulsos; o plano ponderado é específico de empreitadas.
- Desconto semanal é aplicado no próximo fechamento. Desconto final só é aplicado quando o ADM marca fechamento final. Desconto excedente fica pendente para os fechamentos seguintes, conforme decisão do usuário; nunca produz pagamento líquido negativo.
- Cada pagamento registra bruto, descontos e líquido. Bruto quita a empreitada; o dinheiro desembolsado é o líquido. As transações travam o contrato para evitar fechamentos concorrentes inconsistentes.
- Corrigir um pagamento estorna o anterior e cria o novo **na mesma transação**. Um erro desfaz tudo. Estorno restaura os descontos e mantém o lançamento anterior e seus anexos no histórico. Não existe exclusão silenciosa de pagamentos.
- Gastos e pagamentos são apresentados separadamente para evitar duplicar mão de obra já registrada como gasto. O total de gastos é o livro de gastos, não a soma automática de dois livros que podem representar o mesmo desembolso.

## Módulos e roteiro de teste manual

### 1. Base, auth, convites e RLS

Crie usuários A e B, confirme os e-mails e crie uma obra com A. Gere convite USER para B, aceite em outra sessão e tente reutilizá-lo: deve falhar. Teste expiração e revogação. B deve consultar a obra e não conseguir alterar finanças. Um terceiro usuário sem convite não deve enxergar a obra. O último ADM não pode ser removido.

### 2. Gastos e anexos

Como ADM, registre um gasto de 2 unidades a R$ 25: total R$ 50. Edite, filtre por categoria/período/fornecedor/entrega e exporte os filtros para CSV compatível com Excel (UTF-8 BOM, separador `;`, proteção contra fórmulas). Exclua somente após confirmação. Envie foto, PDF e XML; tente enviar SVG, executável renomeado e arquivo acima do limite. Como USER, tente a mesma escrita via API e diretamente no Supabase: deve falhar.

### 3. Empreitada e pagamentos

Crie contrato de R$ 40.000 e serviços com pesos 60% e 40%. Ative o plano e registre 100% e 50%, respectivamente: executado R$ 32.000 (80%). Registre desconto de R$ 150 e bruto de R$ 100: líquido zero, desconto pendente R$ 50. No próximo bruto de R$ 100: líquido R$ 50. Teste adiantamento, estorno e correção. Compare saldo e auditoria. Plano com pesos incompletos não deve ativar.

### 4. Diário, ocorrências e fotos

USER cria problema, atenção, mudança ou andamento e anexa fotos pela câmera/galeria. Somente ADM altera status e responsável depois de criado. Filtre a galeria por data/serviço, abra fotos e baixe documentos. O histórico financeiro e de ocorrências é registrado em `audit_logs`. As imagens são abertas sob demanda usando URLs assinadas de curta duração.

### 5. Dashboard e relatórios

Compare totais com os lançamentos; verifique gráfico de categorias, próximos serviços, últimos registros e execução ponderada. Abra Relatórios para resumo e últimos sete dias; use Imprimir / PDF para gerar documento pelo navegador e CSV para Excel. Confira versão móvel, tema claro/escuro, estados vazios e mensagens de erro.

## IA e pesquisa de preços na internet (OpenAI)

Em **Estimativas → Pesquisar preço na internet**, pergunte o valor do serviço. Não é necessário cadastrar uma base. A região inicial é **Aracaju/SE**, editável. Selecione **Somente mão de obra**, **Material e mão de obra** ou **Somente materiais** para não misturar composições. Exemplo: “Quanto custa reboco por m²? Preciso fazer 40 m²”. Uma pergunta por unidade pode ser respondida sem informar quantidade ou execução.

Na Vercel, use `SAFEOBRA_OPENAI_API_KEY` como **Sensitive**, em **Production**, seguida de novo deploy. A chave fica apenas no servidor. `SAFEOBRA_OPENAI_MODEL` é opcional (padrão `gpt-4.1-mini`) e deve aceitar Responses API, busca web e saída estruturada. A API e as buscas usam o faturamento OpenAI; não estão incluídas na assinatura ChatGPT. A integração não depende de n8n. A descrição, a região e o escopo são enviados à OpenAI; dados e preços cadastrados na obra não são enviados. A requisição usa `store: false`.

A ferramenta `web_search` tem acesso externo habilitado e seu uso é obrigatório. O servidor exige uma busca concluída e só aceita URLs que apareçam nas fontes/citações da resposta da ferramenta. A IA extrai preços publicados em BRL, unidade, composição, região, data do preço quando informada e trecho do valor. Não deve inventar preços, converter unidades ou aplicar fatores regionais sem fonte. A existência da URL na pesquisa não substitui a conferência do conteúdo pelo usuário.

A média em centavos usa os pontos médios das faixas de fontes comparáveis, com uma amostra por site. Fontes locais têm prioridade sobre estaduais e nacionais; valores de outra região são excluídos. Se só houver fonte nacional, a interface avisa expressamente. Cada fonte tem link, faixa por unidade, composição, região, data informada e trecho do preço. A data de pesquisa é gerada no servidor e separada da data do preço. Sem resultado comparável, o app pede mais detalhes do serviço, não cadastro de base.

Quantidade e percentual podem ser ajustados no resultado para simular total e parte realizada sem repetir a pesquisa. O resultado é indicativo e não altera contratos, referências cadastradas ou pagamentos. A calculadora manual continua disponível abaixo.

O endpoint exige sessão, vínculo à obra e origem autorizada. Limites: descrição de 1.600 caracteres, três pesquisas/minuto por usuário e dez por obra, até três chamadas da ferramenta, 45 segundos de espera do provedor e 60 segundos de duração máxima da função. A interface aguarda até 55 segundos. Preços encontrados e disponibilidade dependem das fontes e do acesso do modelo à busca web. Testes automatizados simulam a API; testes reais são executados no deploy usando dados temporários.

## Verificação automatizada

```sh
npm test              # Cálculos, CSV e validação de entradas; sem rede/banco
npm run test:db       # PostgreSQL temporário; migrations reais + RLS/RPC
npm run typecheck
npm run build
npm start
```

`test:db` usa `embedded-postgres` e banco descartável em `/tmp`, porta local 55439. Exige permissão para iniciar processos/portas. Reconstitui contratos mínimos de `auth.uid()`, `auth.users` e Storage para testar SQL real com papéis `authenticated`, `anon`, `service_role`. **Não substitui** validação de Auth, e-mail e Storage no projeto Supabase real. Não aponta para produção. Os dados fictícios existem só nos testes e são removidos ao encerrar.

Os testes de acesso cobrem isolamento da obra, ADM/USER, falsificação de autor, último ADM, convites de uso único, validação dos pesos, rate limit, upload direto proibido, descontos, adiantamentos, correção/estorno e RLS habilitada em todas as tabelas. Nenhuma policy é desativada para fazer os testes passarem.

O build usa webpack para funcionar também em ambientes que restringem as portas internas do Turbopack. A instalação é reproduzida pelo `package-lock.json`.

## Deploy na Vercel

O repositório inclui `vercel.json` e fixa Node.js 24 em `package.json`. O código do app está na branch `work`; ao importar o repositório, use essa branch no deploy. Se desejar produção a partir dela, ajuste a **Production Branch** em Settings → Git para `work`.

As variáveis do ambiente de desenvolvimento não são copiadas automaticamente para a Vercel. Cadastre as cinco variáveis da tabela em **Project → Settings → Environment Variables**, nos ambientes utilizados (Production e/ou Preview). Para `APP_URL`, use a origem HTTPS do deploy, sem barra final. O callback autorizado no Supabase deve ser essa origem seguida de `/auth/callback`.

Para permitir deploy pela API, configure `VERCEL_TOKEN` como segredo na ferramenta de execução, limitado ao destino `api.vercel.com`. Gere-o em https://vercel.com/account/tokens com acesso à conta/equipe do projeto. Esse token é credencial de deploy; não é uma variável de runtime do app e não deve ser enviado ao navegador ou ao Git. Uma conexão do plugin Vercel disponível nesta conversa também pode fornecer o acesso necessário.

1. Envie o projeto para seu repositório e importe na Vercel como Next.js; configure Node 24, build `npm run build`, instalação `npm ci`.
2. Defina as cinco variáveis por ambiente. Use projetos Supabase separados para preview e produção; não exponha service role em variáveis `NEXT_PUBLIC_`.
3. Ajuste `APP_URL`, Site URL e redirects do Supabase ao domínio publicado. As rotas de IA e upload aceitam a origem canônica e, na Vercel, os endereços exatos definidos pelo próprio ambiente em `VERCEL_URL`, `VERCEL_BRANCH_URL` e `VERCEL_PROJECT_PRODUCTION_URL`. Outros projetos `*.vercel.app` continuam bloqueados; cabeçalhos Host não ampliam essa lista. Previews precisam de suas próprias variáveis e configuração de callback no Supabase para login por e-mail.
4. Aplique migrations primeiro, faça o deploy e execute o roteiro manual com contas de teste antes de liberar os usuários.

**Uploads: máximo de 4 MiB por arquivo**, escolhido para respeitar o limite de corpo de requisição de 4,5 MB da Vercel Functions. Cada anexo é enviado em uma requisição separada. O app não promete aceitar arquivos de 10 MB nessa hospedagem. Para aumentar, implemente fluxo de quarentena e validação de conteúdo fora da Function antes de ampliar limites. JPG, PNG, WEBP, HEIC/HEIF, PDF e XML são aceitos. HEIC pode exigir download para visualização em navegadores sem suporte. XML é apenas armazenado/baixado; não é interpretado.

## Checklist antes de produção

- [ ] Revisar RLS e grants de todas as migrations, inclusive Storage, e executar testes ADM/USER no Supabase real.
- [ ] Confirmar e-mail obrigatório, SMTP, URLs exatas de callback, política de senha e rate limits do Supabase Auth.
- [ ] Confirmar service role só no servidor; verificar artefatos de navegador e habilitar secret scanning no repositório.
- [ ] HTTPS, CSP com nonce por requisição, HSTS, `nosniff`, bloqueio de iframe e validação de origem do upload funcionando no domínio real.
- [ ] Conferir `APP_URL`, `RATE_LIMIT_SALT` e ambiente de preview isolado.
- [ ] Testar limites de upload e conteúdo adulterado; bucket continua privado, sem policies de upload direto.
- [ ] Confirmar download assinado expira em 60 segundos e membro removido não consegue novos links. Links já emitidos podem durar até expirar.
- [ ] Definir retenção e backups de dados, auditoria e objetos; revisar restauração. Exclusão de registros financeiros é auditada. Objetos antigos devem ser limpos por rotina administrativa após a retenção definida, nunca tornando o bucket público.
- [ ] Agendar limpeza das chaves antigas de `rate_limits`, preservando pelo menos a janela atual; monitorar volume e abuso.
- [ ] Não registrar senhas, tokens de convite nem URLs assinadas em analytics/logs. Fazer revisão de acessibilidade no dispositivo usado no canteiro.

## Organização

- `src/app`: páginas, callback, upload e exportação.
- `src/components`: formulários e componentes interativos com validação client-side.
- `src/server`: ações, autorização e rate limit compartilhado no PostgreSQL.
- `src/lib`: schemas Zod, tipos, cálculos e cliente Supabase de servidor.
- `supabase/migrations`: tabelas, constraints, índices, transações, auditoria, RLS e Storage.
- `tests`: testes de cálculo e integração de políticas.

Nenhuma publicação, criação de projeto Supabase ou alteração de credenciais é executada automaticamente pelo código.

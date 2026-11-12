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

**Entrar** fica em `/login`; **Criar conta** fica em `/cadastro`. As telas têm títulos, instruções e destaques visuais próprios. O cadastro explica as etapas de criação e acesso, incluindo confirmação por e-mail quando necessária; os links entre as telas também funcionam com o botão Voltar do navegador.

Login e cadastro oferecem **Mostrar/Ocultar senha** e aceitam senhas com pelo menos **6 caracteres**. No Supabase Auth, `password_min_length` deve ser `6`, com a mesma política de caracteres do aplicativo. A visibilidade começa oculta a cada abertura do formulário.

O cadastro respeita a configuração de confirmação do Supabase: quando retorna uma sessão, o app abre o acesso imediatamente; quando exige confirmação, orienta a abrir o link recebido. A aplicação não altera essa configuração. Se o e-mail já tem conta, o erro de cadastro oferece **Entrar na minha conta**, sem alterar a senha existente.

Para projetos que exigem confirmação, configure um **SMTP próprio** em [Supabase → Authentication → SMTP](https://supabase.com/dashboard/project/kjryjmuauloebjvbcvqx/auth/smtp): host, porta, usuário, senha e remetente verificado do seu provedor. Não grave esses valores neste arquivo ou no Git.

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
- Em **Financeiro → Pagamentos**, toque em um desconto e em **Editar** para alterar descrição, valor total ou fechamento de destino. Transferir de semanal para final devolve os abatimentos desse desconto ao líquido dos pagamentos e deixa o desconto pendente para o final. Se ele já estava marcado como final, a opção **Ainda não foi descontado** permite corrigir um abatimento indevido. A operação preserva o bruto, os IDs, os comprovantes e outros descontos, ajusta os vínculos por serviço em centavos e é auditada, exclusiva do ADM e sem duplicação ao repetir. Alterações comuns de descrição/valor preservam o aplicado; reduzir abaixo do aplicado exige primeiro a devolução.
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

### 6. Orçamentos recebidos

Em **Orçamentos → Novo grupo**, cadastre um item de compra/contratação, como Telhado, Piso ou Tintas. Em cada grupo, **Adicionar proposta** recebe empresa, itens/quantidades, valor total com frete e taxas, prazo, condições e fotos ou documentos. Anexos usam o mesmo Storage privado e limite de 4 MiB; um envio com falha pode ser retomado sem criar outra proposta.

A tabela compara as propostas do grupo do menor para o maior preço, destaca empates no menor valor e mostra a diferença em reais. No celular, deslize a tabela; os rótulos permanecem visíveis. Marque uma ou mais propostas para registrar as escolhas; o resumo soma seus valores integrais. Confira o escopo para evitar somar propostas que cobrem o mesmo item. Escolher não cria despesas ou pagamentos. **Editar / anexar** corrige uma proposta ou permite enviar arquivos depois. Somente ADM cadastra, edita, anexa e escolhe; membros consultam e abrem arquivos privados da própria obra.

Teste três grupos com propostas de valores diferentes e iguais, selecione várias, edite valores, recarregue a página e confira o total. Simule falha no upload e no salvamento de uma escolha. Verifique que um membro não consegue repetir uma alteração do ADM, que outra obra não pode usar o grupo e que uma conta sem vínculo não lê propostas ou anexos.

## IA e pesquisa de preços na internet (OpenAI)

Em **Estimativas → Pesquisar preço na internet**, pergunte o valor do serviço. Não é necessário cadastrar uma base. A região inicial é **Aracaju/SE**, editável. Selecione **Somente mão de obra**, **Material e mão de obra** ou **Somente materiais** para não misturar composições. Exemplo: “Quanto custa reboco por m²? Preciso fazer 40 m²”. Uma pergunta por unidade pode ser respondida sem informar quantidade ou execução.

Na Vercel, use `SAFEOBRA_OPENAI_API_KEY` como **Sensitive**, em **Production**, seguida de novo deploy. A chave fica apenas no servidor. `SAFEOBRA_OPENAI_MODEL` é opcional (padrão `gpt-4.1-mini`) e deve aceitar Responses API, busca web e saída estruturada. A API e as buscas usam o faturamento OpenAI; não estão incluídas na assinatura ChatGPT. A integração não depende de n8n. A descrição, a região e o escopo são enviados à OpenAI. Ao vincular uma empreitada, o contexto numérico do contrato e do serviço é usado para comparação; o livro financeiro detalhado e o nome do profissional não são enviados. A requisição usa `store: false`.

A pesquisa usa duas etapas no servidor: primeiro busca na web com citações nativas, depois extrai os preços desse relatório em campos estruturados, limitando as URLs às fontes retornadas pela busca. A ferramenta `web_search` tem acesso externo habilitado e seu uso é obrigatório. O servidor exige uma busca concluída e só aceita URLs que apareçam nas fontes/citações da resposta da ferramenta. A IA extrai preços publicados em BRL, unidade, composição, região, data do preço quando informada e trecho do valor. Não deve inventar preços, converter unidades ou aplicar fatores regionais sem fonte. A existência da URL na pesquisa não substitui a conferência do conteúdo pelo usuário.

A média em centavos usa os pontos médios das faixas de fontes comparáveis, com uma amostra por site. Fontes locais têm prioridade sobre estaduais e nacionais; valores de outra região são excluídos. A localidade precisa ter nome explícito; a classificação municipal exige que a cidade apareça na URL ou no título nativo da citação. A classificação estadual também exige evidência de UF na fonte, evitando transformar páginas nacionais em preços de Aracaju. Se só houver fonte nacional, a interface avisa expressamente. Cada fonte tem link, faixa por unidade, composição, região, data informada e trecho do preço. A data de pesquisa é gerada no servidor e separada da data do preço. Sem resultado comparável, o app pede mais detalhes do serviço, não cadastro de base.

Quantidade e percentual podem ser ajustados no resultado para simular total e parte realizada sem repetir a pesquisa. O resultado é indicativo e não altera contratos, referências cadastradas ou pagamentos. A calculadora manual continua disponível abaixo.

O endpoint exige sessão, vínculo à obra e origem autorizada. Limites: descrição de 1.600 caracteres, três pesquisas/minuto por usuário e dez por obra, até três chamadas da ferramenta, 45 segundos de espera do provedor e 60 segundos de duração máxima da função. A interface aguarda até 55 segundos. Preços encontrados e disponibilidade dependem das fontes e do acesso do modelo à busca web. Testes automatizados simulam a API; testes reais são executados no deploy usando dados temporários.

## Estimativa por diária, equipe e duração

A pesquisa oferece **Automático**, **Preço por serviço/unidade** e **Diária da equipe e tempo de execução**. No automático, pedidos por m² continuam unitários; uma equipe executando uma lista de tarefas pode usar diária. A diária considera somente mão de obra. Pedreiros podem ser extraídos da descrição ou fixados no formulário; a jornada inicial de 8 h/dia é explícita e editável.

A IA pesquisa a **diária individual de pedreiro** em Aracaju/SE, com as mesmas fontes e controles regionais da pesquisa por unidade. Não usa salário mensal, diária de ajudante ou preço de equipe como diária individual. Decompõe as tarefas e estima intervalos de **horas decorridas para a equipe informada**, considerando as etapas sequenciais e preparação/limpeza quando aplicáveis. Não pressupõe que dois pedreiros façam qualquer tarefa na metade do tempo.

Produtividade publicada precisa de URL retornada pela pesquisa e explicação da aplicação do coeficiente. Sem coeficiente publicado, a duração pode ser uma **estimativa técnica aproximada da IA**, com premissas visíveis. Medidas críticas ausentes geram perguntas e bloqueiam o total por duração, preservando a diária por pessoa/equipe disponível. Porcelanato não informa espessura do contrapiso, existência de laje ou condições do solo; essas condições precisam ser informadas ou identificadas como hipóteses de um cenário preliminar.

O servidor soma os tempos uma única vez e calcula em centavos:

- Dias de trabalho = horas totais da equipe ÷ jornada.
- Dias inteiros cobrados = arredondamento para cima dos dias totais, **após somar as etapas**.
- Custo = pedreiros × dias cobrados × diária individual pesquisada.
- A alternativa proporcional usa a fração dos dias e é apresentada separadamente, sujeita ao acordo com os profissionais.

Duas pessoas trabalhando um dia equivalem a duas diárias individuais. Três pequenas tarefas no mesmo dia não viram três diárias de equipe. Tempos já estimados para a equipe não são divididos novamente pelo número de pedreiros. Mudança de equipe exige nova análise dos tempos. O resultado não registra pagamentos automaticamente.

Exemplo de descrição: “2 pedreiros; retirar porcelanato e escavar 3 furos de 60 × 60 cm por 1 m de profundidade; posicionar as treliças; abrir 3 rasgos de 2 m × 30 cm”. Complete profundidade dos rasgos/espessura da parede, dimensões/preparo das treliças, contrapiso/laje, solo e ferramentas para melhorar a estimativa. Os testes usam valores fictícios para verificar a aritmética; não são cotações de Aracaju.

## Navegação e uso no celular

As consultas independentes de cada tela são feitas no mesmo lote paralelo, incluindo o histórico dos relatórios. Fontes completas de preços são carregadas em **Serviços**; as outras áreas leem os valores atuais sem transportar o JSON da pesquisa. A região `pdx1` da Vercel fica próxima ao Supabase deste projeto (`us-west-2`). Nenhum resultado financeiro ou sessão é colocado em cache compartilhado: autenticação, permissões, RLS e atualização após salvar permanecem nas leituras e ações existentes.

O tema escuro usa fundo preto, painéis quase pretos e texto claro neutro, com cores próprias para avisos, erros, indicadores e mensagens de confirmação. A preferência automática do dispositivo é respeitada; o controle em **Conta → Alternar tema** alterna a aparência atual, inclusive quando ela veio do sistema.

O aplicativo tem cinco áreas: **Resumo**, **Serviços**, **Financeiro**, **Obra** e **Orçamentos**, nesta ordem. No celular, a navegação fica fixa no rodapé. Financeiro reúne compras, pagamentos/descontos e relatórios em um seletor; Obra reúne diário/fotos e pessoas/configurações. Links antigos continuam funcionando dentro da área correspondente.

As listas mostram até seis registros por página, com busca e paginação. Toque no registro para abrir um único painel com detalhes e edição, sem empilhar caixas abertas. Serviços mantêm valores, execução, pagamentos e fontes no mesmo painel. Listas importadas também têm uma prévia compacta; somente o item escolhido abre os campos de edição. O contrato em execução mostra apenas os campos que podem ser alterados, preservando o preço original. Dados completos e ações menos frequentes ficam em **Opções**.

Despesas e registros do diário permitem enviar arquivos junto com o cadastro. Se o envio falhar, o reenvio usa o registro já criado. Permissões e regras financeiras continuam sendo verificadas no servidor.

Fechar um painel pelo botão, pelo Esc ou pelo fundo preserva o preenchimento em memória enquanto a tela continua aberta. Cadastros, edições, filtros e arquivos selecionados voltam ao reabrir o mesmo painel. Cada registro mantém seu próprio rascunho, que só é limpo após salvar com sucesso (ou aplicar o filtro). Notas com falha no envio mantêm a fila de reenvio ligada ao registro já criado. Recarregar ou sair da tela encerra esses rascunhos; eles não são gravados no navegador nem enviados ao banco antes de salvar.

Em despesas, **Categoria** aceita um nome digitado ou uma sugestão. Categorias já usadas na obra aparecem nas sugestões, nos filtros, no resumo por categoria e na exportação CSV.

Em **Financeiro → Compras e despesas**, escolha **Pago** ou **A pagar** no cadastro. As listas **Pagas** e **A pagar** são separadas; ao quitar um item, abra-o e use **Marcar como pago**, ou altere a situação na edição. A tela retorna à lista correspondente. O Resumo separa **Despesas pagas** de **Materiais a pagar**; o total comprado continua sendo a soma dos dois, também identificado nos relatórios e no CSV. Pagamento e entrega são controles independentes. Quitar uma despesa mantém o mesmo registro, seus anexos e o valor original; não cria um pagamento de mão de obra. Despesas anteriores à inclusão desse controle permanecem como pagas e podem ser reclassificadas pelo ADM.

## Tabela de serviços da empreitada e IA

Em **Serviços**, selecione o contrato para acompanhar serviços, estimativas e saldo. A tabela mostra itens a realizar, em andamento e concluídos, classificação incluído/extra, avanço, estimativa de mercado, valor cobrado/alocado, pago líquido e saldo. No celular, as linhas viram cartões. ADM adiciona/edita itens, registra conclusão, pesquisa preços, aprova extras e vincula pagamentos. USER consulta.

O preço original continua preservado. Os itens incluídos distribuem esse preço, sem somá-lo de novo; sua soma não pode ultrapassá-lo. Extras só aumentam o total quando explicitamente aprovados com valor. O avanço usa valores combinados/alocados × execução de cada serviço, incluindo extras aprovados. Valores ainda não distribuídos mantêm o plano incompleto. Concluir serviço atualiza avanço e restante, sem criar pagamento.

**Organizar plano atual nesta tabela** importa os serviços do plano antigo, preserva seus IDs e aproveita pagamentos por serviço. O plano anterior fica como histórico imutável. Pagamentos semanais/adiantamentos sem vínculo ficam **a distribuir**: reduzem o saldo geral, mas não aparecem ficticiamente como pagos em um item. A distribuição limita bruto, descontos e líquido ao pagamento real, não cria dinheiro nem novas transações. Estornos deixam de compor o pago dos itens e restauram os descontos conforme as regras existentes.

A ação principal **Salvar e calcular preços**, com a opção **Calcular preços com IA após salvar** grava os itens revisados e inicia o orçamento com pesquisa web. Também é possível usar **Orçar lista** para serviços já cadastrados. Cada serviço recebe pesquisa independente; a interface processa até oito buscas em paralelo por chamada, com até quatro grupos por minuto por ADM e doze por obra, pode ser interrompida e salva os resultados conforme ficam prontos. Uma barra mostra quantos serviços foram processados e quantos têm preço. Antes de gravar, uma revisão por IA confere se o preço corresponde à tarefa e se a medição foi informada, evitando usar, por exemplo, assentamento de piso como proteção de áreas ou presumir altura de parede. Itens sem referência compatível recebem uma busca alternativa pela diária do profissional adequado. Mantenha a página aberta durante a pesquisa. O prompt prioriza um preço por serviço em linguagem natural. Quando falta medição, a tabela mostra faixa por unidade (R$/m², metro, peça/conjunto etc.) e pede a quantidade para o total; a quantidade provisória de um serviço completo não é uma área inventada. Se não houver preço específico, a pesquisa pode trazer a diária publicada do profissional adequado como referência alternativa, deixando o total pendente de duração e equipe. O resultado considera o total atual da empreitada, a parcela e o avanço do item e os pagamentos reais. A busca de mercado é independente do orçamento: o preço combinado não serve como fonte de preço. O contexto numérico é usado na comparação; IDs internos e nome do profissional não são enviados à IA de pesquisa. A referência de pagamento pelo executado é calculada no servidor a partir do contrato, não inventada pelo modelo. A comparação não muda preço ou pagamento automaticamente.

**Sugerir distribuição do preço original** propõe parcelas proporcionais às estimativas de todos os itens incluídos. Exige referências completas, preserva cada centavo e apresenta prévia para revisão. Alterar descrição, quantidade ou unidade invalida a pesquisa anterior. Se o serviço mudar enquanto a IA pesquisa, o resultado não sobrescreve o novo escopo.

Na aba **Estimativa de serviços**, é possível selecionar empreitada e serviço para comparar com o orçamento e o que já foi pago. Uma pesquisa avulsa não é confundida com o valor da empreitada inteira.

### Arquivo de texto

O ADM pode carregar `.txt`, `.md` ou `.csv` em UTF-8 (até 64 KB, 16 mil caracteres e 60 serviços por arquivo), ou colar o texto. A própria IA interpreta tabelas, códigos, grupos, unidades e campos em branco pelo prompt, sem um parser específico para cada planilha. Cabeçalhos e subtotais não viram serviços; códigos e grupos são preservados, e itens "se contratados" ficam como extras sem aprovação. Medições ausentes são descritas como pendências, com cadastro provisório de um serviço completo, sem inventar metros ou áreas. A IA recebe esse texto e o preço original para organizar dados, não para inventar estimativas de mercado. Os itens, medidas, valores, execução e pagamentos citados aparecem em prévia editável; a pesquisa de preços usa o fluxo de mercado com fontes. Nada é gravado até **Salvar alterações** ou **Salvar e calcular preços**.

Pagamentos citados só viram lançamentos se o ADM marcar **Registrar os pagamentos históricos informados** e conferir a data. São registrados como líquidos históricos sem aplicar automaticamente descontos pendentes. Marque apenas se não constarem no histórico; pagamentos de itens já existentes não são reimportados. Lotes têm chave de idempotência e itens não podem repetir nome/classificação na mesma empreitada. Sem marcar, os valores informados não criam pagamento. O arquivo original não vai para um bucket público: o texto é processado e os dados estruturados são guardados nas tabelas privadas da obra.

Migração: `202611070002_contract_items.sql`. Tabelas novas têm RLS, leitura por membros e mutações por funções que exigem ADM; gravação de pesquisa da IA é exclusiva do servidor. As regras legadas de pagamentos/descontos continuam compatíveis para contratos ainda não convertidos. A adoção e os eventos de itens/pagamentos têm auditoria.

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

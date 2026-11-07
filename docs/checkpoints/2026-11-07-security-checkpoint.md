# Checkpoint de segurança — Máquina de Líder / D2D 2.0

**Data:** 07/11/2026 (America/Sao_Paulo)  
**Repositório:** `misaeljuliano/maquina-de-lider`  
**Finalidade:** preservar o estado conhecido do código, das conversas de trabalho e das verificações de segurança sem alterar `main` nem executar mudanças no banco.

## Estado Git registrado

- Branch de origem: `feat/gerente-lead-observation`.
- HEAD da branch de origem: `42d3bbf3f3b64bf8dfc9031c8d2eb18961e83637` (`Add secure leader deactivation`), igual a `origin/feat/gerente-lead-observation` no início do checkpoint.
- `origin/main`: `2e04630afa1314bde7361abb3938218f54923b7b` (`Escape seller WhatsApp helper in page script`).
- Remote `origin`: `https://github.com/misaeljuliano/maquina-de-lider.git`.
- Havia duas alterações locais não commitadas. Elas foram incluídas neste checkpoint para evitar perda: `supabase/review/wallet_first_access.sql` e `tests/lead-observation.sql`.
- A branch de checkpoint parte do HEAD de trabalho acima e preserva os commits existentes da branch de funcionalidade. Não altera `main` nem a branch original.

## Conversas e escopo incluídos

O inventário foi feito pela lista de conversas do Codex e do ChatGPT. Títulos e resumos foram usados para localizar o trabalho; conversas continuam sendo registros separados e não foram modificadas.

- **D2D 2.0 | Lead Machine - Recuperado:** definições do produto, segurança e checkpoint documental anterior.
- **Verificar estado do repositório Git:** confirmação de branch, remote e alterações locais.
- **Implementar edição auditada de observações:** edição de `leads.observation` restrita a gerente, auditoria de ator/data/valores anterior e novo, `crm_external_id` somente leitura até definição do CRM.
- **Implementar idempotência de leads:** UUID por submissão, preservação em retries, conflito idempotente e rejeição de payload divergente.
- **Implementar acesso à Minha Carteira:** login, primeiro acesso, recuperação e autorização pela carteira.
- **Criar checkpoint do D2D 2.0:** registro documental anterior, antes mantido em cópia local isolada.
- **D2D 2.0 | Lead Machine - Original** e conversas auxiliares de marca/cartão executivo: contexto histórico e visual, sem código incluído por esses títulos.
- Projeto local **maquina-de-lider**: identificado no Codex como repositório Git em `C:\Users\Pimen\Documents\maquina-de-lider`. O conteúdo desse checkout não foi lido porque o ambiente negou acesso. Seu worktree aparece apontando para `main` em `2e04630` no inventário Git compartilhado; limpeza local desse checkout não foi confirmada.

## Código e verificações

- A branch de trabalho contém alterações de carteira, hierarquia/transferência de vendedores e desativação de gestores. A comparação local entre `origin/main` e HEAD mostra 11 arquivos, aproximadamente 1.983 inserções e 177 remoções.
- A busca no código encontrou implementação e testes de idempotência em `src/index.js` e `tests/lead-idempotency.test.mjs`, usando `submission_id`. O histórico consultado registra que o PR #1 foi mesclado em `main`; o estado atual do arquivo principal inclui essa funcionalidade.
- As alterações locais incluídas neste checkpoint endurecem a permissão da função `wallet_password_ready()` e ampliam testes SQL de acesso aos campos privados da observação. `git diff --check` não apontou erro de whitespace.
- Não foram executados testes nesta verificação. A validade funcional dos dois arquivos locais continua pendente de execução de testes e revisão independente.
- Nenhuma chave, token, senha, dado de cliente ou segredo de configuração foi incluído intencionalmente neste documento. As alterações locais examinadas contêm SQL de permissões e testes com dados fictícios.

## Supabase — estado observado

Os projetos `maquina-de-lider-staging` (`hmlinyowvggqpqgzbuhw`) e `PROJETO D2D 2.0 | LEAD MACHINE` (`xmipdjjdtruutcumhrzb`) estavam `ACTIVE_HEALTHY` na consulta. Foram apenas consultados o histórico de migrações e os avisos de segurança; nada foi aplicado ou alterado nesta tarefa.

- Produção registra migrações até `secure_leader_deactivation` (`20261107221050`), incluindo auditoria de observações, portão de primeiro acesso, perfil do supervisor existente, transferência hierárquica e desativação segura.
- Staging registra migrações até `secure_leader_deactivation` (`20261107211935`) e tem migrações adicionais para homologação/ajustes de primeiro acesso. Os históricos de staging e produção não são idênticos; comparar migrações antes de futuras promoções.
- O linter de segurança reportou tabelas com RLS ativo sem políticas explícitas: tabelas privadas de auditoria/acesso/hierarquia e `seller_onboarding`. Isso pode ser intencional quando o acesso ocorre só por funções privilegiadas, mas exige confirmar grants, exposição dos schemas e o caminho de acesso previsto.
- O linter também reportou funções `SECURITY DEFINER` executáveis por `authenticated`: `manager_lead_private_fields`, `manager_update_lead_observation` e `wallet_password_ready`. O relatório não prova uma falha explorável: essas RPCs são esperadas pelo fluxo e devem aplicar autorização interna. Revisar corpo, `search_path`, grants e testes de não gerente; não remover os grants sem avaliar o impacto funcional.
- A proteção do Supabase Auth contra senhas vazadas está desativada em ambos os ambientes segundo o advisor. Avaliar ativação na configuração Auth.

## Riscos e pendências

1. Revisar os três avisos de `SECURITY DEFINER` e confirmar que cada RPC faz checagem de autorização robusta antes de retornar/alterar dados.
2. Confirmar que schemas privados e tabelas sem policies não são acessíveis por `anon`/`authenticated` por grants ou APIs expostas.
3. Rodar testes de carteira, observação/auditoria, hierarquia/desativação e idempotência em ambiente isolado antes da próxima publicação.
4. Revisar e validar os dois ajustes locais de primeiro acesso e testes SQL. Eles foram preservados, não homologados.
5. Comparar a sequência de migrações staging/produção antes de novos deploys ou alterações de banco.
6. Confirmar a limpeza local do checkout principal `C:\Users\Pimen\Documents\maquina-de-lider` em uma sessão com acesso a esse diretório.
7. O push deste checkpoint pode acionar uma prévia do Cloudflare para a branch de checkpoint. Não deve publicar `main` nem a produção; confirmar a configuração de preview se a plataforma mudar.

## Recuperação

1. Clone ou atualize `https://github.com/misaeljuliano/maquina-de-lider.git`.
2. Faça checkout da branch `codex/security-checkpoint-2026-11-07` para recuperar o documento e as duas alterações locais preservadas.
3. Para recuperar somente um arquivo, use `git show codex/security-checkpoint-2026-11-07:<caminho>`.
4. Não mescle esta branch em `main` automaticamente. Primeiro revise os diffs, rode testes e avalie os avisos de segurança registrados.
5. Alterações no banco devem ser recuperadas/reaplicadas por migrações revisadas, não pelo checkout desta branch.

## Limites deste checkpoint

Este é um snapshot Git com registro de estado e pendências, não um backup físico do banco Supabase nem uma exportação integral dos chats. Nenhum segredo foi copiado. As leituras do banco e dos advisors foram feitas em 07/11/2026; esses estados podem mudar depois.


/**
 * O contrato de uma fonte de dados do Flow.
 *
 * Já foi um cliente HTTP. Até 27/08/2026 este arquivo falava com a API de
 * integração (`/v1/lancamentos`, `/v1/produtos`, `/v1/resumo`) usando um token
 * por restaurante, e a carteira do radar era a lista de tokens configurados.
 *
 * Isso saiu por dois motivos. O primeiro é que não escala: token por cliente
 * significa cadastro manual a cada restaurante novo. O segundo é maior — a API
 * não expõe `qtd` nem `insumoId` no lançamento de compra, e sem quantidade não
 * existe preço unitário, só gasto. O banco expõe.
 *
 * Quem lê o Flow hoje é `carteira.ts`. Sobrou daqui só a interface, porque é
 * ela que permite os testes rodarem com dado de mentira e a investigação rodar
 * com o dump salvo em disco.
 *
 * A API de integração continua existindo e continua sendo da Lidera — ela é o
 * caminho para quem é de fora. O radar é de dentro.
 */

import type { DadosFlow } from './tipos';

export interface FonteFlow {
  buscar(clienteId: string): Promise<DadosFlow>;
}

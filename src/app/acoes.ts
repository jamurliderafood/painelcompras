'use server';

/**
 * O botão "atualizar agora".
 *
 * Relê o Flow de UM cliente e regrava a foto dele. É a mesma rodada que o cron
 * faz — `rodarCliente` — e não uma versão paralela: duas sequências de gravação
 * diferentes é como se produz banco com metade dos dados atualizados.
 */

import { revalidatePath } from 'next/cache';
import { abrirCarteira, fonteDe, listarClientes } from '../coleta/clientes';
import { rodarCliente } from '../coleta/rodada';
import { sincronizarClientes, temBanco } from '../db/supabase';

export async function atualizarCliente(formData: FormData): Promise<void> {
  const id = String(formData.get('cliente') ?? '');
  const data = String(formData.get('data') ?? '');
  if (!id || !data) return;

  const carteira = abrirCarteira();
  const clientes = await listarClientes(carteira);
  const cliente = clientes.find((c) => c.id === id);
  if (!cliente) return;

  // Cliente que apareceu no Flow depois da última rodada ainda não está na
  // nossa tabela, e sem ele a gravação falha por chave estrangeira.
  if (temBanco()) await sincronizarClientes([cliente]);

  await rodarCliente(cliente, fonteDe(carteira), data);

  revalidatePath('/');
  revalidatePath(`/cliente/${id}`);
}

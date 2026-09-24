import { createClient } from '@supabase/supabase-js';

// Configurado no arquivo .env (veja .env.example)
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_KEY;

export const isConfigured = Boolean(url && key);
const supabase = isConfigured ? createClient(url, key) : null;

export class WrongPasswordError extends Error {}

export async function listRoutes() {
  const { data, error } = await supabase
    .from('routes')
    .select('id, name, distance_m, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getRoute(id) {
  const { data, error } = await supabase
    .from('routes')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function saveRoute(route) {
  const { error } = await supabase.from('routes').insert(route);
  if (error) throw error;
}

// Retorna false se o trajeto já não existia
export async function deleteRoute(id, password) {
  const { data, error } = await supabase.rpc('delete_route', { route_id: id, password });
  if (error) {
    if (error.code === '28P01') throw new WrongPasswordError();
    throw error;
  }
  return data;
}

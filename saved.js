import { isConfigured, listRoutes, getRoute, deleteRoute, WrongPasswordError } from './api.js';

const listEl = document.getElementById('saved-list');
const statusEl = document.getElementById('saved-status');
const refreshBtn = document.getElementById('saved-refresh');

const deleteDialog = document.getElementById('delete-dialog');
const deleteForm = document.getElementById('delete-form');
const deleteNameEl = document.getElementById('delete-name');
const deletePassword = document.getElementById('delete-password');
const deleteError = document.getElementById('delete-error');
const deleteSubmit = document.getElementById('delete-submit');

let routeToDelete = null;

// onOpen(route) é chamado quando o usuário abre um trajeto salvo
export function initSavedTab({ onOpen }) {
  refreshBtn.addEventListener('click', refresh);

  async function refresh() {
    if (!isConfigured) {
      statusEl.textContent = 'Salvamento indisponível: o banco de dados não foi configurado.';
      return;
    }
    statusEl.textContent = 'Carregando...';
    try {
      const routes = await listRoutes();
      statusEl.textContent = routes.length ? '' : 'Nenhum trajeto salvo ainda.';
      listEl.replaceChildren(...routes.map((r) => renderItem(r)));
    } catch (err) {
      console.error(err);
      statusEl.textContent = 'Não foi possível carregar os trajetos.';
    }
  }

  function renderItem(route) {
    const li = document.createElement('li');

    const info = document.createElement('div');
    info.className = 'saved-info';
    const name = document.createElement('strong');
    name.textContent = route.name;
    const details = document.createElement('span');
    details.textContent = `${formatKm(route.distance_m)} km · ` +
      new Date(route.created_at).toLocaleDateString('pt-BR');
    info.append(name, details);

    const openBtn = document.createElement('button');
    openBtn.textContent = 'Abrir';
    openBtn.className = 'primary';
    openBtn.addEventListener('click', async () => {
      openBtn.disabled = true;
      try {
        onOpen(await getRoute(route.id));
      } catch (err) {
        console.error(err);
        alert('Não foi possível abrir o trajeto.');
      } finally {
        openBtn.disabled = false;
      }
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Excluir';
    deleteBtn.className = 'danger';
    deleteBtn.addEventListener('click', () => askDelete(route));

    li.append(info, openBtn, deleteBtn);
    return li;
  }

  function askDelete(route) {
    routeToDelete = route;
    deleteNameEl.textContent = route.name;
    deletePassword.value = '';
    deleteError.textContent = '';
    deleteDialog.showModal();
  }

  deleteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    deleteSubmit.disabled = true;
    deleteError.textContent = '';
    try {
      await deleteRoute(routeToDelete.id, deletePassword.value);
      deleteDialog.close();
      refresh();
    } catch (err) {
      if (err instanceof WrongPasswordError) {
        deleteError.textContent = 'Senha incorreta.';
      } else {
        console.error(err);
        deleteError.textContent = 'Erro ao excluir. Tente novamente.';
      }
    } finally {
      deleteSubmit.disabled = false;
    }
  });

  document.getElementById('delete-cancel').addEventListener('click', () => deleteDialog.close());

  return { refresh };
}

export function formatKm(meters) {
  return (meters / 1000).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

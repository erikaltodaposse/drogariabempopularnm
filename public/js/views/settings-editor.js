import { api } from '../api.js';
import { h, fill, showError, busy } from '../dom.js';
import { WEEKDAYS } from '../weekdays.js';

export function settingsEditor({ setGuard }) {
  let dirty = false;
  setGuard(() => !dirty || window.confirm('Há ajustes não salvos. Sair mesmo assim?'));

  const error = h('p', { class: 'alert alert-error', role: 'alert', hidden: true });
  const okMsg = h('p', { class: 'alert alert-ok', role: 'status', hidden: true });
  const form = h('form', { novalidate: true }, h('p', { class: 'boot' }, 'Carregando…'));
  form.addEventListener('input', () => { dirty = true; showError(okMsg, ''); });

  const input = (id, label, attrs, hint) =>
    h('div', { class: 'field' }, h('label', { for: id }, label), h('input', { id, name: id, ...attrs }), hint && h('p', { class: 'field-hint' }, hint));

  function render(s) {
    form.replaceChildren(
      input('nome_loja', 'Nome da drogaria', { type: 'text', maxlength: '80', value: s.nome_loja, required: true }),
      input('meta_pontos', 'Meta diária de pontos (de cada funcionário)', { type: 'number', inputmode: 'numeric', min: '1', max: '10000', step: '1', value: String(s.meta_pontos) }),
      h(
        'div',
        { class: 'edit-row' },
        input('turno_inicio', 'Início do turno', { type: 'time', value: s.turno_inicio }),
        input('turno_fim', 'Fim do turno', { type: 'time', value: s.turno_fim }),
      ),
      input('bonus_base', 'Bônus-base (R$)', { type: 'text', inputmode: 'decimal', value: String(s.bonus_base).replace('.', ',') },
        'Ouro paga 100%, Prata 75% e Bronze 50% deste valor. Deixe 0 enquanto não houver bônus.'),
      h(
        'fieldset',
        { class: 'apply' },
        h('legend', {}, 'Dias com expediente'),
        WEEKDAYS.map((name, d) =>
          h('span', { class: 'check-field' },
            h('input', { type: 'checkbox', id: `wd-${d}`, name: 'dias', value: String(d), checked: s.dias_expediente.includes(d) }),
            h('label', { for: `wd-${d}` }, name)),
        ),
      ),
      h(
        'fieldset',
        { class: 'apply' },
        h('legend', {}, 'Ponto pela etiqueta NFC'),
        h('span', { class: 'check-field' },
          h('input', { type: 'checkbox', id: 'nfc-required', name: 'ponto_exige_nfc', checked: s.ponto_exige_nfc }),
          h('label', { for: 'nfc-required' }, 'Exigir a etiqueta para registrar entrada e saída')),
        h('p', { class: 'field-hint' }, 'Ligue só depois de gravar a etiqueta (instruções abaixo). Desligado, o botão comum também funciona.'),
      ),
      error,
      okMsg,
      h('button', { type: 'submit', class: 'btn' }, 'Salvar ajustes'),
    );
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showError(error, '');
    const body = {
      nome_loja: form.nome_loja.value,
      meta_pontos: Number(form.meta_pontos.value),
      turno_inicio: form.turno_inicio.value,
      turno_fim: form.turno_fim.value,
      bonus_base: form.bonus_base.value.trim() || '0',
      dias_expediente: [...form.querySelectorAll('input[name=dias]:checked')].map((el) => Number(el.value)),
      ponto_exige_nfc: form.ponto_exige_nfc.checked,
    };
    try {
      const res = await busy(form.querySelector('button[type=submit]'), 'Salvando…', () => api.saveSettings(body));
      dirty = false;
      render(res.settings);
      showError(okMsg, 'Ajustes salvos.');
    } catch (err) {
      showError(error, err.message);
    }
  });

  api
    .getSettings()
    .then((res) => render(res.settings))
    .catch((err) => form.replaceChildren(h('p', { class: 'alert alert-error', role: 'alert' }, err.message)));

  return h(
    'div',
    {},
    h('section', { class: 'card' }, h('h2', {}, 'Ajustes da drogaria'), h('p', { class: 'muted' }, 'Meta, turno, bônus, dias de expediente e ponto pela etiqueta.'), form),
    teamCard(),
    managersCard(),
    nfcCard(),
  );
}

function teamCard() {
  const card = h('section', { class: 'card', 'aria-labelledby': 'team-edit-title' }, h('p', { class: 'boot' }, 'Carregando…'));

  function row(emp) {
    const error = h('p', { class: 'alert alert-error', role: 'alert', hidden: true });
    const okMsg = h('p', { class: 'alert alert-ok', role: 'status', hidden: true });
    const nameId = `emp-name-${emp.id}`;
    const pinId = `emp-pin-${emp.id}`;
    const nameInput = h('input', { id: nameId, type: 'text', maxlength: '60', value: emp.name, autocomplete: 'off' });
    const pinInput = h('input', { id: pinId, type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '6', autocomplete: 'off', placeholder: '4 a 6 números' });
    const saveName = h('button', { type: 'button', class: 'btn btn-outline' }, 'Salvar nome');
    const resetPin = h('button', { type: 'button', class: 'btn btn-outline' }, 'Definir PIN provisório');
    saveName.addEventListener('click', async () => {
      showError(error, '');
      showError(okMsg, '');
      try {
        const res = await busy(saveName, 'Salvando…', () => api.renameEmployee(emp.id, nameInput.value));
        emp.name = res.employee.name;
        showError(okMsg, 'Nome salvo.');
      } catch (err) {
        showError(error, err.message);
      }
    });
    resetPin.addEventListener('click', async () => {
      showError(error, '');
      showError(okMsg, '');
      const pin = pinInput.value.trim();
      if (!window.confirm(`Trocar o PIN de ${emp.name} para ${pin}? Ele sai do app e escolhe um PIN novo no próximo acesso.`)) return;
      try {
        await busy(resetPin, 'Salvando…', () => api.resetEmployeePin(emp.id, pin));
        pinInput.value = '';
        showError(okMsg, `Pronto. ${emp.name} entra com o PIN ${pin} e escolhe um novo.`);
      } catch (err) {
        showError(error, err.message);
      }
    });
    return h('li', { class: 'team-row' },
      h('div', { class: 'field' }, h('label', { for: nameId }, 'Nome'), nameInput),
      saveName,
      h('div', { class: 'field mt' }, h('label', { for: pinId }, 'PIN provisório (se esqueceu o PIN)'), pinInput),
      resetPin,
      emp.must_change_pin && h('p', { class: 'field-hint mt' }, 'Ainda não trocou o PIN inicial.'),
      error,
      okMsg);
  }

  api.listEmployees()
    .then(({ employees }) => fill(
      card,
      h('h2', { id: 'team-edit-title' }, 'Funcionários'),
      h('p', { class: 'muted' }, 'Cada um entra no app com o próprio PIN. Os PINs não podem se repetir.'),
      h('ul', { class: 'mgr-list team-list' }, employees.map(row)),
    ))
    .catch((err) => fill(card, h('p', { class: 'alert alert-error', role: 'alert' }, err.message)));
  return card;
}

function managersCard() {
  const card = h('section', { class: 'card', 'aria-labelledby': 'mgr-title' }, h('p', { class: 'boot' }, 'Carregando…'));
  const error = h('p', { class: 'alert alert-error', role: 'alert', hidden: true });
  const okMsg = h('p', { class: 'alert alert-ok', role: 'status', hidden: true });

  function render(managers) {
    const form = h(
      'form',
      { novalidate: true, class: 'mt' },
      h('h3', { class: 'sub-title' }, 'Cadastrar outro acesso da gerência'),
      h('div', { class: 'field' }, h('label', { for: 'mgr-name' }, 'Nome'), h('input', { id: 'mgr-name', name: 'name', type: 'text', maxlength: '60', autocomplete: 'off' })),
      h('div', { class: 'field' }, h('label', { for: 'mgr-email' }, 'E-mail'), h('input', { id: 'mgr-email', name: 'email', type: 'email', maxlength: '120', autocomplete: 'off' })),
      h('div', { class: 'field' }, h('label', { for: 'mgr-pass' }, 'Senha (mínimo 8 caracteres)'), h('input', { id: 'mgr-pass', name: 'password', type: 'password', minlength: '8', autocomplete: 'new-password' })),
      error,
      okMsg,
      h('button', { type: 'submit', class: 'btn' }, 'Cadastrar acesso'),
    );
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      showError(error, '');
      const body = { name: form.name.value, email: form.email.value, password: form.password.value };
      try {
        const res = await busy(form.querySelector('button[type=submit]'), 'Cadastrando…', () => api.createManager(body));
        render([...managers, res.manager]);
        showError(okMsg, `${res.manager.name} já pode entrar com o e-mail ${res.manager.email} e a senha cadastrada.`);
      } catch (err) {
        showError(error, err.message);
      }
    });
    fill(
      card,
      h('h2', { id: 'mgr-title' }, 'Gerência'),
      h('p', { class: 'muted' }, 'Quem entra no painel com e-mail e senha. Todos veem e editam tudo.'),
      h('ul', { class: 'mgr-list' }, managers.map((m) =>
        h('li', {},
          h('strong', {}, m.name, m.is_me && h('span', { class: 'muted' }, ' (você)')),
          h('span', { class: 'mgr-email' }, m.email),
          !m.is_me && h('button', {
            type: 'button',
            class: 'mini mini-danger',
            onclick: async (e) => {
              if (!window.confirm(`Remover o acesso de ${m.name}? A pessoa sai do painel na hora.`)) return;
              try {
                await busy(e.currentTarget, 'Removendo…', () => api.removeManager(m.id));
                render(managers.filter((x) => x.id !== m.id));
              } catch (err) {
                showError(error, err.message);
              }
            },
          }, 'Remover')))),
      form,
    );
  }

  api.listManagers().then((res) => render(res.managers)).catch((err) => fill(card, h('p', { class: 'alert alert-error', role: 'alert' }, err.message)));
  return card;
}

function nfcCard() {
  const card = h('section', { class: 'card', 'aria-labelledby': 'nfc-title' }, h('p', { class: 'boot' }, 'Carregando…'));
  const msg = h('p', { class: 'copied', role: 'status' });

  function render({ path }) {
    const url = `${window.location.origin}${path}`;
    const input = h('input', { id: 'nfc-url', type: 'text', readonly: true, value: url });
    input.addEventListener('focus', () => input.select());
    const rotate = h('button', { type: 'button', class: 'btn btn-outline mt' }, 'Gerar novo código');
    rotate.addEventListener('click', async () => {
      if (!window.confirm('Gerar um novo código? A etiqueta atual para de funcionar até ser gravada de novo.')) return;
      try {
        render(await busy(rotate, 'Gerando…', () => api.rotateNfc()));
        msg.textContent = 'Novo código gerado. Grave o link novo na etiqueta.';
      } catch (err) {
        msg.textContent = err.message;
      }
    });
    fill(
      card,
      h('h2', { id: 'nfc-title' }, 'Etiqueta NFC do ponto'),
      h('p', { class: 'muted' }, 'Cada funcionário encosta o celular na etiqueta da drogaria e o app registra a entrada dele. Na saída, ele pede confirmação.'),
      h('div', { class: 'field mt' }, h('label', { for: 'nfc-url' }, 'Link para gravar na etiqueta'), input),
      h('button', {
        type: 'button',
        class: 'btn',
        onclick: async () => {
          try {
            await navigator.clipboard.writeText(url);
            msg.textContent = 'Link copiado.';
          } catch {
            input.focus();
            msg.textContent = 'Não deu para copiar. O link está selecionado: copie manualmente.';
          }
        },
      }, 'Copiar link'),
      msg,
      h('h3', { class: 'sub-title mt' }, 'Como gravar'),
      h('ol', { class: 'pending-list' },
        h('li', {}, 'Instale o app gratuito NFC Tools no celular (Android ou iPhone).'),
        h('li', {}, 'Abra Escrever, toque em Adicionar registro e escolha URL.'),
        h('li', {}, 'Cole o link acima e confirme.'),
        h('li', {}, 'Toque em Escrever e encoste o celular na etiqueta.'),
        h('li', {}, 'Teste: encoste o celular de cada funcionário na etiqueta. O app deve abrir.'),
        h('li', {}, 'Funcionou? Ligue "Exigir a etiqueta" nos ajustes acima e salve.')),
      h('p', { class: 'field-hint' }, 'Guarde o link só na etiqueta. Se ele vazar, gere um novo código e grave de novo.'),
      rotate,
    );
  }

  api.nfc().then(render).catch((err) => fill(card, h('p', { class: 'alert alert-error', role: 'alert' }, err.message)));
  return card;
}

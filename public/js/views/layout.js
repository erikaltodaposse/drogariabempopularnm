import { h } from '../dom.js';

export function header({ title = 'Checkpoint', subtitle, actions } = {}) {
  return h(
    'header',
    { class: 'header' },
    h(
      'div',
      { class: 'header-row' },
      h(
        'div',
        { class: 'header-id' },
        h('img', { class: 'header-logo', src: '/img/logo.svg', alt: 'Drogaria Bem Popular', width: '52', height: '52' }),
        h('div', {}, h('h1', { class: 'brand' }, title), subtitle && h('p', { class: 'sub' }, subtitle)),
      ),
      actions,
    ),
  );
}

/** Cabeçalho grande da tela de login, com a logo em destaque. */
export function loginHeader() {
  return h(
    'header',
    { class: 'header login-hero' },
    h('img', { class: 'login-logo', src: '/img/logo-drogaria.jpg', alt: 'Drogarias Bem Popular Brasil', width: '523', height: '366' }),
    h('h1', { class: 'brand' }, 'Checkpoint'),
    h('p', { class: 'sub' }, 'Tarefas e desempenho da equipe'),
  );
}

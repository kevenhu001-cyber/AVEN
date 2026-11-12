/* global $, state, actions, render, openSidebar, closeSidebar, switchTerminal, sendChat, fieldValues */
/* Prototype checks injected after the app script by html_preview. */
(() => {
  let passed = 0;
  const failures = [];
  const check = (name, ok) => (ok ? passed++ : failures.push(name));
  const click = (selector) => {
    const node = $(selector);
    check(`exists ${selector}`, Boolean(node));
    node?.click();
  };
  const fits = (name) => {
    check(
      name,
      document.documentElement.scrollWidth <= innerWidth + 1 &&
        $('#view').scrollWidth <= $('#view').clientWidth + 1,
    );
  };
  try {
    fits('initial viewport');
    check(
      'no shadows on primary surfaces',
      [...document.querySelectorAll('.connection-card,.composer,.sidebar')].every(
        (n) => getComputedStyle(n).boxShadow === 'none',
      ),
    );
    check(
      'rounded primary card',
      parseFloat(getComputedStyle($('.connection-card')).borderTopLeftRadius) === 20,
    );
    if (innerWidth === 390) {
      const action = $('[data-action="connect"]').getBoundingClientRect();
      const composer = $('.composer-zone').getBoundingClientRect();
      check(
        'mobile primary card action visible above composer',
        action.bottom <= composer.top && action.top > 0,
      );
    }
    check(
      'chat is the main surface',
      Boolean($('#transcript')) && !document.querySelector('.bottom-nav'),
    );
    click('[data-action="connect"]');
    check(
      'clicking connect does not send',
      state.connection === 'preview' && state.snapshot === null,
    );
    switchTerminal(true);
    check(
      'receiver sees no preconfirmation data',
      !$('#view').textContent.includes(fieldValues.interest[1]),
    );
    switchTerminal(false);
    state.connection = 'preview';
    render();
    for (const c of [...document.querySelectorAll('[data-field]')]) {
      c.checked = false;
      c.dispatchEvent(new Event('change', { bubbles: true }));
    }
    check('empty selection disables send', $('[data-action="send-invite"]').disabled);
    click('[data-field="interest"]');
    state.network = false;
    render();
    check('offline input cannot send', $('[data-action="send-invite"]').disabled);
    state.network = true;
    render();
    click('[data-action="cancel-preview"]');
    check('cancel did not share', state.snapshot === null && state.connection === 'suggested');
    click('[data-action="connect"]');
    click('[data-field="name"]');
    click('[data-action="send-invite"]');
    check('invitation requires explicit send', state.connection === 'pending');
    check(
      'snapshot omits unselected project and name',
      !('project' in state.snapshot) && !('name' in state.snapshot),
    );
    switchTerminal(true);
    check(
      'receiver sees selected interest only',
      $('#view').textContent.includes(fieldValues.interest[1]) &&
        !$('#view').textContent.includes(fieldValues.project[1]),
    );
    check('receiver does not see unselected name', !$('#view').textContent.includes('林同学'));
    click('[data-action="accept"]');
    check('receiver decides independently', state.connection === 'accepted');
    check('accepted view still omits unselected name', !$('#view').textContent.includes('林同学'));
    switchTerminal(false);
    check('sender sees acceptance', $('#view').textContent.includes('接受了你的邀请'));
    click('[data-action="manage"]');
    check(
      'management shows confirmed snapshot',
      $('#sheet').textContent.includes(fieldValues.interest[1]),
    );
    click('[data-action="revoke"]');
    check('opening revocation does not revoke', !state.revoked);
    click('[data-action="confirm-revoke"]');
    switchTerminal(true);
    check(
      'revocation hides peer snapshot',
      !$('#view').textContent.includes(fieldValues.interest[1]) &&
        $('#view').textContent.includes('已被撤销'),
    );
    const revoked = state.revoked;
    actions['confirm-revoke']();
    check('receiver cannot mutate grant', state.revoked === revoked);
    switchTerminal(false);
    state.revoked = false;
    state.snapshot = null;
    state.connection = 'suggested';
    actions.demo();
    click('[data-action="dismiss"]');
    check(
      'skip recommendation sends nothing',
      state.connection === 'dismissed' && state.snapshot === null,
    );
    actions.new();
    check('new chat has quiet landing', state.mode === 'home' && !$('.connection-card'));
    click('[data-action="tools"]');
    check('tools menu opens', !$('#tools-menu').hidden);
    click('[data-plugin="opportunity"]');
    check(
      'plugin becomes composer chip',
      state.plugin === 'opportunity' && $('.composer-chips').textContent.includes('机会'),
    );
    check('plugin enable did not authorize sharing', state.snapshot === null);
    click('[data-action="remove-plugin"]');
    check('plugin can be removed', state.plugin === null);
    actions.plugins();
    click('[data-action="toggle-plugin"]');
    check('connection plugin can be disabled', !state.pluginOn);
    actions['close-sheet']();
    state.connection = 'suggested';
    actions.demo();
    click('[data-action="connect"]');
    check('disabled plugin cannot prepare invitation', state.connection === 'suggested');
    state.pluginOn = true;
    actions.new();
    $('#prompt').value = '<img src=x onerror=alert(1)>';
    $('#prompt').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    $('#prompt').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    check('composition Enter does not send', state.messages.length === 0);
    $('#prompt').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    sendChat();
    check('untrusted prompt is text', !$('#view img') && state.messages.length === 1);
    actions.stop();
    check('stop pending reply', !state.generating);
    actions.context();
    click('#ai-context');
    click('[data-action="save-context"]');
    check(
      'context choice is reflected in composer',
      state.context && $('.composer-rail').textContent.includes('已选本人上下文'),
    );
    actions.settings();
    actions.theme();
    check('light mode works', document.documentElement.dataset.mode === 'light');
    actions.theme();
    actions['close-sheet']();
    if (matchMedia('(max-width:768px)').matches) {
      openSidebar();
      check(
        'drawer opens and main becomes inert',
        $('#shell').classList.contains('drawer-open') && $('#view').inert,
      );
      closeSidebar();
      check('drawer closes and main restored', !$('#view').inert);
    }
    document.documentElement.style.fontSize = '200%';
    actions.demo();
    fits('200% text in chat');
    actions.new();
    fits('200% text on landing');
    document.documentElement.style.fontSize = '';
  } catch (error) {
    failures.push(String(error));
  }
  state.mode = 'suggestion';
  state.terminal = 'sender';
  state.connection = 'suggested';
  state.fields = ['name', 'interest'];
  state.snapshot = null;
  state.revoked = false;
  state.messages = [];
  state.context = false;
  state.plugin = 'connect';
  state.pluginOn = true;
  actions['close-sheet']();
  render();
  $('#toast').hidden = true;
  console.log(JSON.stringify({ prototype: 'v0.3', width: innerWidth, passed, failures }));
})();

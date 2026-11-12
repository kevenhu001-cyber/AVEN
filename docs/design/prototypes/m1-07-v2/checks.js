/* global names, navigate, $, state, render, selectedOpportunity, actions */
/* Design-only interaction checks. Inject after index.html in html_preview. */
(() => {
  let passed = 0;
  const failures = [];
  const assert = (name, ok) => {
    if (ok) passed++;
    else failures.push(name);
  };
  const click = (selector) => {
    const node = document.querySelector(selector);
    assert(`exists: ${selector}`, Boolean(node));
    node?.click();
  };
  try {
    for (const route of Object.keys(names)) {
      navigate(route);
      assert(
        `${route}: no horizontal overflow`,
        $('#main-content').scrollWidth <= $('#main-content').clientWidth + 1,
      );
      assert(`${route}: content rendered`, $('#main-content').textContent.trim().length > 20);
      for (const variant of ['loading', 'empty', 'error', 'denied', 'disabled']) {
        state.variant = variant;
        render();
        assert(`${route}/${variant}: recovery exists`, Boolean($('[data-action="recover"]')));
      }
    }
    navigate('discover');
    const search = $('#opportunity-search');
    search.value = '不存在的领域';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    assert('search empty state', $('#opportunity-results').textContent.includes('没有找到'));
    click('[data-action="clear-search"]');
    click('[data-opportunity="robot"]');
    click('[data-action="apply"]');
    assert('relation purpose defaults unchecked', !$('#relation-consent').checked);
    const checkboxes = [...document.querySelectorAll('[data-field]')];
    checkboxes.forEach((node) => {
      node.checked = false;
      node.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert('zero fields disables send', $('[data-action="send-referral"]').disabled);
    click('[data-field="name"]');
    click('[data-action="send-referral"]');
    assert(
      'confirmation contains recipient and selected value',
      $('#modal').open &&
        $('#modal-body').textContent.includes('林同学') &&
        $('#modal-body').textContent.includes(selectedOpportunity.org),
    );
    click('#modal-cancel');
    assert('cancel did not send', !state.sent);
    click('[data-action="send-referral"]');
    click('#modal-confirm');
    assert('sent referral visible', state.sent && state.route === 'referrals');
    actions['switch-identity']();
    assert('organization context', state.identity === 'organization' && state.route === 'inbox');
    assert(
      'unselected skills absent from snapshot',
      !$('#main-content').textContent.includes('Python、数据分析'),
    );
    click('[data-action="accept"]');
    click('#modal-confirm');
    assert(
      'accepted relationship has no automatic sharing',
      state.accepted && $('#main-content').textContent.includes('尚未共享资料'),
    );
    navigate('memory');
    assert('personal memory switches to personal identity', state.identity === 'personal');
    const pendingBefore = state.pendingMemories;
    click('[data-action="review-memory"]');
    click('#modal-confirm');
    assert('memory confirmation changes count', state.pendingMemories === pendingBefore - 1);
    // Independent consent revocation must not remove an unrelated grant.
    state.relation = true;
    state.accepted = true;
    state.revoked = false;
    state.relationRevoked = false;
    navigate('privacy');
    assert(
      'two separate grants',
      Boolean($('[data-action="revoke"]')) && Boolean($('[data-action="revoke-relation"]')),
    );
    click('[data-action="revoke"]');
    click('#modal-confirm');
    assert(
      'referral revocation leaves relationship grant active',
      state.revoked && !state.relationRevoked,
    );
    navigate('space');
    assert(
      'relationship snapshot still available',
      $('#main-content').textContent.includes('独立授权') &&
        $('#main-content').textContent.includes('林同学'),
    );
    navigate('privacy');
    click('[data-action="revoke-relation"]');
    click('#modal-confirm');
    navigate('space');
    assert(
      'relationship snapshot hidden on its own revocation',
      $('#main-content').textContent.includes('关系授权已撤销'),
    );
    navigate('settings');
    click('[data-setting="appearance"]');
    const theme = $('#theme-select');
    theme.value = 'light';
    theme.dispatchEvent(new Event('change', { bubbles: true }));
    assert('light theme', document.documentElement.dataset.theme === 'light');
    theme.value = 'dark';
    theme.dispatchEvent(new Event('change', { bubbles: true }));
    click('[data-setting="notifications"]');
    click('[data-action="notification"]');
    assert(
      'notification preference is visibly toggled',
      $('[data-action="notification"]').getAttribute('aria-pressed') === 'true',
    );
    navigate('ai');
    $('#prompt').value = '<img src=x onerror=alert(1)>';
    $('#prompt').dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    $('#prompt').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert('IME composition Enter does not send', state.messages.length === 0);
    $('#prompt').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    $('#chat-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    assert(
      'prompt rendered as escaped text',
      state.messages.length === 1 && !$('#main-content img'),
    );
    click('[data-action="stop"]');
    assert('stop cancels pending mock reply', !state.generating && state.messages.length === 1);
    if (matchMedia('(max-width:560px)').matches) {
      click('#open-drawer');
      assert(
        'mobile drawer opens and main is inert',
        $('#app').classList.contains('drawer-open') && $('#main-content').inert,
      );
      click('#profile');
      assert('profile menu opens', !$('#profile-menu').hidden);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      assert(
        'Escape closes drawer and restores main',
        !$('#app').classList.contains('drawer-open') && !$('#main-content').inert,
      );
    }
    // A text scaling check supplements the fixed viewport passes.
    document.documentElement.style.fontSize = '200%';
    for (const route of Object.keys(names)) {
      navigate(route);
      assert(
        `${route}: 200% text no horizontal overflow`,
        $('#main-content').scrollWidth <= $('#main-content').clientWidth + 1,
      );
    }
    document.documentElement.style.fontSize = '';
    assert('no document overflow', document.documentElement.scrollWidth <= innerWidth + 1);
  } catch (error) {
    failures.push(String(error));
  }
  actions.newchat();
  $('#toast').hidden = true;
  console.log(JSON.stringify({ designChecks: true, width: innerWidth, passed, failures }));
})();

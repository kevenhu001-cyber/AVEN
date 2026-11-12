/* global $, state, actions, render, showConnector */
/* Reference-card styling and explicit authorization checks; prototype only. */
window.avenConnectorChecks = (async () => {
  let passed = 0;
  const failures = [];
  const check = (name, ok) => (ok ? passed++ : failures.push(name));
  const fits = () =>
    document.documentElement.scrollWidth <= innerWidth + 1 &&
    $('#view').scrollWidth <= $('#view').clientWidth + 1;
  try {
    showConnector('gmail');
    await Promise.all([...document.querySelectorAll('img')].map((img) => img.decode()));
    check(
      'Gmail renders in a horizontal connector card',
      Boolean($('.connector-card:not(.stacked)')),
    );
    check(
      'official Gmail image loads',
      $('.connector-logo').complete && $('.connector-logo').naturalWidth > 0,
    );
    check(
      'card has pronounced round corners',
      parseFloat(getComputedStyle($('.connector-card')).borderTopLeftRadius) === 28,
    );
    check(
      'input has capsule geometry',
      parseFloat(getComputedStyle($('.composer')).borderTopLeftRadius) >= 32,
    );
    check('input starts in one compact row', $('.composer').getBoundingClientRect().height < 60);
    check(
      'assistant uses rounded bubble',
      parseFloat(getComputedStyle($('.message.assistant > p')).borderTopLeftRadius) === 26,
    );
    check(
      'all outline SVG endpoints are rounded',
      [...document.querySelectorAll('svg')].every(
        (svg) =>
          svg.getAttribute('stroke-linecap') === 'round' &&
          svg.getAttribute('stroke-linejoin') === 'round',
      ),
    );
    check(
      'rectangular SVG shapes have rounded internal corners',
      [...document.querySelectorAll('svg rect[width]')].every(
        (rect) =>
          Number(rect.getAttribute('rx')) >= Math.min(5, Number(rect.getAttribute('width')) / 3),
      ),
    );
    check('initial connector fits viewport', fits());
    actions['authorize-connector']();
    check('authorization preview does not connect', state.connectorStates.gmail === 'disconnected');
    check(
      'authorization names scope and excludes contacts/calendar',
      $('#sheet').textContent.includes('不包含日历或联系人权限'),
    );
    check(
      'authorization describes prototype boundary',
      $('#sheet').textContent.includes('不读取真实邮箱'),
    );
    actions['cancel-connector']();
    check('cancel preserves disconnected state', state.connectorStates.gmail === 'denied');
    check('cancel feedback is visible', $('.connector-card').textContent.includes('你取消了授权'));
    check('cancel state fits viewport', fits());
    actions.network();
    check('offline disables authorization', $('[data-action="authorize-connector"]').disabled);
    actions['authorize-connector']();
    check('offline cannot open authorization', $('#sheet').hidden);
    actions.network();
    check('network recovery never auto connects', state.connectorStates.gmail === 'denied');
    actions['authorize-connector']();
    actions['confirm-connector']();
    check(
      'explicit confirmation creates simulated connection',
      state.connectorStates.gmail === 'connected',
    );
    check('connected card says simulated', $('.connector-card').textContent.includes('设计模拟'));
    showConnector('outlook');
    await Promise.all([...document.querySelectorAll('img')].map((img) => img.decode()));
    check('Outlook uses stacked gray card variant', Boolean($('.connector-card.stacked')));
    check(
      'provider authorizations stay independent',
      state.connectorStates.outlook === 'disconnected',
    );
    check(
      'Outlook association is full width',
      $('.connector-authorize').getBoundingClientRect().width >
        $('.connector-card').getBoundingClientRect().width * 0.8,
    );
    check('Outlook retains following message bubble', Boolean($('.connector-followup')));
    check(
      'Outlook official image loads',
      $('.connector-logo').complete && $('.connector-logo').naturalWidth > 0,
    );
    showConnector('gmail');
    actions['disconnect-connector']();
    check('disconnect requires separate confirmation', state.connectorStates.gmail === 'connected');
    actions['confirm-disconnect']();
    check(
      'disconnect resets only selected provider',
      state.connectorStates.gmail === 'disconnected' &&
        state.connectorStates.outlook === 'disconnected',
    );
    document.documentElement.style.fontSize = '200%';
    render();
    check('Gmail at 200 percent text fits viewport', fits());
    showConnector('outlook');
    check('Outlook at 200 percent text fits viewport', fits());
  } catch (error) {
    failures.push(String(error));
  } finally {
    document.documentElement.style.fontSize = '';
    state.network = true;
    state.connectorStates = { gmail: 'disconnected', outlook: 'disconnected' };
    showConnector('gmail');
    $('#toast').hidden = true;
  }
  return { prototype: 'v0.4', width: innerWidth, passed, failures };
})();

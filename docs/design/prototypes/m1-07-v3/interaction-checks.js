/* global $, state, actions, render, switchTerminal, sendChat */
/* Run after checks.js in a real browser; await window.avenInteractionChecks. */
window.avenInteractionChecks = (async () => {
  const failures = [];
  let passed = 0;
  const check = (name, condition) => (condition ? passed++ : failures.push(name));
  const input = (value) => {
    $('#prompt').value = value;
    $('#prompt').dispatchEvent(new Event('input', { bubbles: true }));
  };
  const waitForReply = () => new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    actions.new();
    check('empty composer disables sending', $('.send').disabled);
    input('   \n ');
    check('whitespace cannot send', $('.send').disabled);
    input('第一行\n第二行\n第三行\n第四行');
    check('multiline composer grows', $('#prompt').getBoundingClientRect().height > 70);
    actions.tools();
    $('[data-plugin="amap"]').click();
    check('plugin selection retains draft', $('#prompt').value.includes('第四行'));
    actions.context();
    $('#ai-context').click();
    actions['save-context']();
    check('context selection retains draft', $('#prompt').value.includes('第四行'));
    check(
      'focus returns to composer after replaced trigger',
      document.activeElement.id === 'prompt',
    );
    input('x'.repeat(1850));
    check(
      'near limit shows count',
      !$('#draft-count').hidden && $('#draft-count').textContent.includes('1850'),
    );
    check('textarea height remains bounded', $('#prompt').getBoundingClientRect().height <= 156);
    input('发送方私人草稿');
    switchTerminal(true);
    check('draft does not cross terminal boundary', !$('#prompt').value.includes('发送方私人草稿'));
    switchTerminal(false);
    check('returning terminal restores own draft', $('#prompt').value === '发送方私人草稿');
    actions.network();
    sendChat();
    check(
      'offline blocks chat and keeps draft',
      $('.send').disabled && $('#prompt').value === '发送方私人草稿' && state.messages.length === 0,
    );
    actions.network();
    check('reconnection never auto sends', state.messages.length === 0 && !state.generating);
    actions.new();
    input('这是一条失败恢复消息');
    actions['reply-failure']();
    sendChat();
    await waitForReply();
    check(
      'failed reply has recovery UI',
      state.replyError && Boolean($('[data-action="retry-reply"]')),
    );
    input('生成期间继续写的草稿');
    actions['retry-reply']();
    await waitForReply();
    check(
      'retry does not duplicate user message',
      state.messages.filter((m) => m.role === 'user').length === 1,
    );
    check(
      'retry produces one assistant reply',
      !state.replyError && state.messages.filter((m) => m.role === 'assistant').length === 1,
    );
    check('incoming response keeps unsent draft', $('#prompt').value === '生成期间继续写的草稿');
    input('停止后不会出现延迟回复');
    sendChat();
    actions.stop();
    const messageCount = state.messages.length;
    await waitForReply();
    check(
      'stop cancels delayed response',
      !state.generating && state.messages.length === messageCount,
    );
    actions.tools();
    const first = $('#tools-menu button');
    first.focus();
    first.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    check(
      'arrow down navigates ability menu',
      document.activeElement === $('#tools-menu').querySelectorAll('button')[1],
    );
    document.activeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    check(
      'escape restores menu trigger focus',
      $('#tools-menu').hidden && document.activeElement.id === 'tools-toggle',
    );
    actions.plugins();
    check(
      'panel declares modal semantics',
      $('#sheet').getAttribute('role') === 'dialog' &&
        $('#sheet').getAttribute('aria-modal') === 'true',
    );
    check(
      'modal isolates all background controls',
      $('#view').inert && $('#sidebar').inert && $('.topbar').inert && $('.preview-controls').inert,
    );
    $('#mcp-url').focus();
    check('modal form field receives focus', document.activeElement.id === 'mcp-url');
    document.activeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    check(
      'modal closes and restores background',
      $('#sheet').hidden && !$('#view').inert && !$('.topbar').inert,
    );
    actions.ordinary();
    state.messages = Array.from({ length: 25 }, (_, i) => ({
      role: i % 2 ? 'assistant' : 'user',
      text: `${i}：较长的样例消息，用于检查向上阅读时新回复不会抢走滚动位置。`,
    }));
    render({ follow: true });
    input('需要稍后回复的新消息');
    sendChat();
    $('#transcript').scrollTop = 0;
    $('#transcript').dispatchEvent(new Event('scroll'));
    await waitForReply();
    check('new response preserves reader scroll', $('#transcript').scrollTop === 0);
    check('reader can find latest-message cue', !$('[data-action="latest"]').hidden);
    actions.latest();
    check(
      'latest cue scrolls to bottom',
      $('#transcript').scrollHeight - $('#transcript').clientHeight - $('#transcript').scrollTop <
        2,
    );
    state.snapshot = { interest: '仅供授权接收的样例正文' };
    state.connection = 'pending';
    switchTerminal(true);
    actions.network();
    check(
      'offline receiver hides granted content',
      !$('#view').textContent.includes('仅供授权接收的样例正文'),
    );
    actions.network();
    check(
      'online receiver restores current authorized snapshot',
      $('#view').textContent.includes('仅供授权接收的样例正文'),
    );
  } catch (error) {
    failures.push(String(error));
  } finally {
    actions.stop();
    state.network = true;
    state.connection = 'suggested';
    state.snapshot = null;
    state.revoked = false;
    state.drafts = { sender: '', receiver: '' };
    switchTerminal(false);
    actions.demo();
    $('#toast').hidden = true;
  }
  return { prototype: 'v0.3.1', width: innerWidth, passed, failures };
})();

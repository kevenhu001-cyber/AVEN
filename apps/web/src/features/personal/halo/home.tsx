import { Mascot } from '../mascot';

/** Shared welcome for the home and chat routes; the composer remains the primary action. */
export function ChatWelcome() {
  return (
    <div className="halo-chat-empty">
      <Mascot size={48} state="idle" />
      <h1>今天，想聊点什么？</h1>
      <p className="muted">从一个还没成形的想法开始也可以。</p>
    </div>
  );
}

import Image from 'next/image';
import { Button } from '@/components/ui/button';
const colors = ['green', 'pink', 'tan', 'violet', 'red', 'orange', 'blue', 'amber', 'teal'];
export function AuthWelcome({ onContinue }: { onContinue: () => void }) {
  return (
    <main className="personal-app auth-theme auth-entry" aria-labelledby="welcome-title">
      <section className="auth-entry-hero">
        <div className="auth-characters" aria-hidden="true">
          {colors.map((color) => (
            <Image
              key={color}
              unoptimized
              loading="eager"
              src={`/mascot/welcome-${color}.svg`}
              width={160}
              height={160}
              alt=""
              className={`auth-character auth-character-${color}`}
            />
          ))}
        </div>
        <div className="auth-entry-copy">
          <h1 id="welcome-title">AVEN</h1>
          <p>
            让想法被理解，
            <br />
            让连接自然发生。
          </p>
        </div>
      </section>
      <div className="auth-entry-actions">
        <Button className="auth-submit" onClick={onContinue}>
          登录或注册
        </Button>
        <p>每一次分享，都由你决定。</p>
        <span>开发验证版 · 模型状态登录后显示</span>
      </div>
    </main>
  );
}

import Image from 'next/image';
/* SVG assets contain no scripts; CSS honors prefers-reduced-motion. */
export function Mascot({
  state = 'idle',
  large = false,
}: {
  state?: 'idle' | 'thinking' | 'happy' | 'sleepy' | 'static';
  large?: boolean;
}) {
  // Unoptimized SVG preserves its embedded CSS animation.
  return (
    <Image
      unoptimized
      loading="eager"
      className={large ? 'mascot mascot-large' : 'mascot'}
      src={`/mascot/aven-${state}.svg`}
      width={large ? 160 : 40}
      height={large ? 160 : 40}
      alt=""
      aria-hidden="true"
    />
  );
}

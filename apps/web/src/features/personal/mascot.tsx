/*
 * Inline AVEN mascot: the confirmed perfect circle with two capsule eyes, ported from
 * docs/design/prototypes/mascot-motion (8 motion states). In the Halo dark theme the body is
 * white and the eyes take the canvas colour, matching the reference while keeping the geometry.
 * Motion is pure CSS (halo.css) and stops under prefers-reduced-motion. The state must come
 * from real UI/agent state; it is never a progress indicator by itself.
 */
export type MascotState =
  'idle' | 'blink' | 'curious' | 'happy' | 'thinking' | 'surprise' | 'sleepy' | 'hello' | 'static';

export function Mascot({
  state = 'idle',
  large = false,
  size,
  badge = false,
  className = '',
}: {
  state?: MascotState;
  large?: boolean;
  size?: number;
  badge?: boolean;
  className?: string;
}) {
  const px = size ?? (large ? 96 : 28);
  return (
    <span
      className={`halo-mascot ${className}`.trim()}
      data-motion={state}
      style={{ width: px, height: px }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 200 200" width={px} height={px} focusable="false">
        <g className="m-float">
          <g className="m-tilt">
            <g className="m-pulse">
              <circle className="m-body" cx="100" cy="100" r="96" />
              <g className="m-look">
                <g className="m-expression">
                  <g className="m-eye m-eye-left">
                    <g className="m-lid">
                      <rect className="m-normal" x="69" y="50" width="22" height="46" rx="11" />
                      <path className="m-happy" d="M69 76 Q80 61 91 76" />
                    </g>
                  </g>
                  <g className="m-eye m-eye-right">
                    <g className="m-lid">
                      <rect className="m-normal" x="111" y="52" width="22" height="46" rx="11" />
                      <path className="m-happy" d="M111 78 Q122 63 133 78" />
                    </g>
                  </g>
                </g>
              </g>
            </g>
          </g>
        </g>
      </svg>
      {badge && (
        <span className="halo-mascot-badge">
          <svg viewBox="0 0 24 24" width="12" height="12" focusable="false">
            <path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
          </svg>
        </span>
      )}
    </span>
  );
}

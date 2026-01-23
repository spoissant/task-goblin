import type { ReactNode } from "react";

const URL_REGEX = /(https?:\/\/[^\s<]+[^\s<.,;:!?"')}\]])/g;

interface LinkifyProps {
  children: string;
}

export function Linkify({ children }: LinkifyProps): ReactNode {
  const parts = children.split(URL_REGEX);

  return parts.map((part, i) => {
    if (URL_REGEX.test(part)) {
      // Reset regex lastIndex since we're using global flag
      URL_REGEX.lastIndex = 0;
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 hover:underline dark:text-blue-400"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

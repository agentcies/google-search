
import React from 'react';

interface MarkdownContentProps {
  content: string;
}

const MarkdownContent: React.FC<MarkdownContentProps> = ({ content }) => {
  const formatText = (text: string) => {
    // Basic code block handler
    const segments = text.split(/(```[\s\S]*?```)/g);

    return segments.map((segment, idx) => {
      if (segment.startsWith('```')) {
        const code = segment.replace(/```(\w+)?\n?/, '').replace(/```$/, '');
        return (
          <pre key={idx} className="my-4 p-4 rounded-xl bg-black/60 border border-slate-800 overflow-x-auto font-mono text-xs text-cyan-300">
            <code>{code}</code>
          </pre>
        );
      }

      return segment.split('\n').map((line, i) => {
        if (line.startsWith('### ')) return <h3 key={`${idx}-${i}`} className="text-xl font-bold text-cyan-400 mt-6 mb-2">{line.replace('### ', '')}</h3>;
        if (line.startsWith('## ')) return <h2 key={`${idx}-${i}`} className="text-2xl font-bold text-white mt-8 mb-4 border-b border-slate-800 pb-2">{line.replace('## ', '')}</h2>;
        if (line.startsWith('# ')) return <h1 key={`${idx}-${i}`} className="text-3xl font-extrabold text-white mt-10 mb-6">{line.replace('# ', '')}</h1>;
        
        if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
          return <li key={`${idx}-${i}`} className="ml-6 list-disc text-slate-300 my-1">{line.trim().substring(2)}</li>;
        }

        const boldParts = line.split(/(\*\*.*?\*\*)/g);
        const formattedLine = boldParts.map((part, j) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={j} className="text-cyan-300 font-semibold">{part.slice(2, -2)}</strong>;
          }
          return part;
        });

        if (line.trim() === '') return <div key={`${idx}-${i}`} className="h-2" />;
        
        return <p key={`${idx}-${i}`} className="text-slate-300 leading-relaxed my-2">{formattedLine}</p>;
      });
    });
  };

  return (
    <div className="prose prose-invert max-w-none">
      {formatText(content)}
    </div>
  );
};

export default MarkdownContent;

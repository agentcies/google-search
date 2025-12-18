
import React from 'react';

interface MarkdownContentProps {
  content: string;
}

const MarkdownContent: React.FC<MarkdownContentProps> = ({ content }) => {
  // Simple regex-based formatter for UI purposes
  // In a production app, we'd use a real markdown parser, but here we'll simulate it beautifully.
  const formatText = (text: string) => {
    return text
      .split('\n')
      .map((line, i) => {
        // Headers
        if (line.startsWith('### ')) return <h3 key={i} className="text-xl font-bold text-blue-400 mt-6 mb-2">{line.replace('### ', '')}</h3>;
        if (line.startsWith('## ')) return <h2 key={i} className="text-2xl font-bold text-white mt-8 mb-4 border-b border-gray-800 pb-2">{line.replace('## ', '')}</h2>;
        if (line.startsWith('# ')) return <h1 key={i} className="text-3xl font-extrabold text-white mt-10 mb-6">{line.replace('# ', '')}</h1>;
        
        // Lists
        if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
          return <li key={i} className="ml-6 list-disc text-gray-300 my-1">{line.trim().substring(2)}</li>;
        }

        // Bold
        const parts = line.split(/(\*\*.*?\*\*)/g);
        const formattedLine = parts.map((part, j) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={j} className="text-blue-300 font-semibold">{part.slice(2, -2)}</strong>;
          }
          return part;
        });

        if (line.trim() === '') return <br key={i} />;
        
        return <p key={i} className="text-gray-300 leading-relaxed my-2">{formattedLine}</p>;
      });
  };

  return (
    <div className="prose prose-invert max-w-none">
      {formatText(content)}
    </div>
  );
};

export default MarkdownContent;

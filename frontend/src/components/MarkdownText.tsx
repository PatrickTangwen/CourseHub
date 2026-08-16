import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";

export const MarkdownText = () => (
  <MarkdownTextPrimitive smooth={false} remarkPlugins={[remarkGfm]} className="aui-md" />
);

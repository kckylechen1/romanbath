import React from "react";
import { ChatConfig } from "../../types";
import GenerationSettings from "../GenerationSettings";

interface GenerationTabProps {
  config: ChatConfig;
  onConfigChange: (config: ChatConfig) => void;
}

const GenerationTab: React.FC<GenerationTabProps> = ({
  config,
  onConfigChange,
}) => {
  return (
    <GenerationSettings config={config} onConfigChange={onConfigChange} />
  );
};

export default GenerationTab;

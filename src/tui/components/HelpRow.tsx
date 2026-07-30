import { Box, Text } from "ink";
import type { FC } from "react";

export type Mode = "form" | "results";

export type Props = {
  mode: Mode;
  canDownload?: boolean;
};

export const HelpRow: FC<Props> = ({ mode, canDownload }) => {
  if (mode === "form") {
    return (
      <Box flexDirection="row">
        <Text color="white" bold>
          Tips:
        </Text>
        <Text> </Text>
        <Box flexDirection="column">
          <Text dimColor>
            Tab: switch field • Enter: search • Ctrl+s: setup • Esc: quit
          </Text>
          {canDownload && (
            <Text dimColor>
              Ctrl+v: repair videos • Ctrl+a: queue entire database • Ctrl+d:
              start queue
            </Text>
          )}
          <Text dimColor>Ctrl+f: view failed downloads</Text>
        </Box>
      </Box>
    );
  }
  return (
    <Box>
      <Text color="white" bold>
        Tips:
      </Text>
      <Text> </Text>
      {canDownload ? (
        <Box flexDirection="column">
          <Text dimColor>
            ↑/↓: select • Enter: download • Ctrl+q: queue song • Ctrl+a: queue
            page
          </Text>
          <Text dimColor>
            Ctrl+p: queue all • Ctrl+d: start queue • ←/→: page • Ctrl+e: edit
            search
          </Text>
          <Text dimColor>Ctrl+r: refresh • Esc: back</Text>
        </Box>
      ) : (
        <Text dimColor>
          ↑/↓: select • ←/→: page • Ctrl+e: edit search • Ctrl+r: refresh • Esc:
          back
        </Text>
      )}
    </Box>
  );
};

export default HelpRow;

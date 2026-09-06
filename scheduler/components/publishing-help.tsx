import { HelpLink } from "@/components/help-link";
import { getPlatformName } from "@/lib/config";
import { platformHelpPath } from "@/lib/docs";

export function PublishingHelp({ platforms }: { platforms: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2">
      <HelpLink path="/publishing">Publishing and media help</HelpLink>
      {[...new Set(platforms)].map((platform) => (
        <HelpLink key={platform} path={platformHelpPath(platform)}>
          {getPlatformName(platform)} requirements
        </HelpLink>
      ))}
    </div>
  );
}

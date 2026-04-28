import * as React from "react";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 transition-all duration-200 cursor-pointer font-medium",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg btn-glow hover:-translate-y-px",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-lg hover:-translate-y-px",
        outline:
          "border border-border bg-transparent text-foreground hover:bg-secondary hover:text-foreground hover:border-border rounded-lg hover:-translate-y-px",
        secondary:
          "bg-secondary text-foreground hover:bg-secondary/80 rounded-lg hover:-translate-y-px",
        ghost: "text-foreground hover:bg-secondary hover:text-foreground rounded-lg",
        link: "text-foreground underline-offset-4 hover:underline hover:text-primary",
      },
      size: {
        default: "h-10 px-5 py-2 text-sm",
        sm: "h-9 rounded-lg px-3 text-sm",
        lg: "h-12 px-8 py-3 text-base rounded-lg",
        icon: "size-10 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp ref={ref} data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

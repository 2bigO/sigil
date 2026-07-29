import { type CompilationEvent, compile, MockAdapter } from "../src/mod.ts";
import { assertEquals, assertMatch } from "@std/assert";

async function workspace(source: string): Promise<string> {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(`${root}/.sigil`);
  await Deno.writeTextFile(
    `${root}/.sigil/config.json`,
    JSON.stringify({
      sigilVersion: "0.5.0",
      workspace: { name: "test", members: [] },
      files: { include: ["**/*.sigil"], exclude: [] },
      tools: {},
    }),
  );
  await Deno.writeTextFile(`${root}/main.sigil`, source);
  return root;
}

// @sigil tests packages/compiler/#module.sigil::SigilCompiler::CompilationStatus logic,cases
Deno.test("standard profile becomes green only with complete warning-free evaluation", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`);
  try {
    const events: CompilationEvent[] = [];
    const report = await compile(root, { kind: "workspace" }, {
      adapter: new MockAdapter(),
      onEvent: (event) => {
        events.push(event);
      },
    });
    assertEquals(report.status, "green");
    assertEquals(
      report.stages.every((item) => item.state === "completed"),
      true,
    );
    assertEquals(events.at(-1)?.type, "completed");
    assertEquals(
      events.map((event) => event.sequence),
      events.map((_, i) => i + 1),
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/#module.sigil::SigilCompiler::CompilationStatus logic,cases
Deno.test("warnings produce yellow and errors produce red", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`);
  try {
    const warning = {
      code: "DESIGN_WARNING",
      severity: "warning" as const,
      message: "Boundary is unclear.",
      evidence: "The interface omits its result.",
      impact: "Consumers cannot rely on the operation.",
      correction: "Define the result.",
    };
    const yellow = await compile(root, { kind: "workspace" }, {
      adapter: new MockAdapter([warning]),
    });
    assertEquals(yellow.status, "yellow");
    const red = await compile(root, { kind: "workspace" }, {
      adapter: new MockAdapter([{ ...warning, severity: "error" }]),
    });
    assertEquals(red.status, "red");
    assertMatch(red.diagnostics[0].fingerprint, /^[a-f0-9]{64}$/);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// @sigil tests packages/compiler/#module.sigil::SigilCompiler::StageConfiguration constraints,cases
Deno.test("critical-system adds risk evaluation without implementation stages", async () => {
  const root = await workspace(`component Example {
  goal {
    Explain the example.
  }

  interface {
    ExampleOperation {
      run()
    }
  }
}
`);
  try {
    const report = await compile(root, { kind: "workspace" }, {
      profile: "critical-system",
      adapter: new MockAdapter(),
    });
    assertEquals(
      report.stages.find((item) => item.id === "standards-risk")?.state,
      "completed",
    );
    assertEquals(
      report.stages.some((item) =>
        item.id.includes("implementation") ||
        item.id.includes("code-generation")
      ),
      false,
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

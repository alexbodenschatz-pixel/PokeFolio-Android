namespace PokeFolio.Desktop;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Any(argument => string.Equals(argument, "--self-test", StringComparison.OrdinalIgnoreCase)))
        {
            var result = StartupValidator.Validate(new SharedWebAssetLocator());
            if (!result.Success)
            {
                foreach (var error in result.Errors)
                {
                    Console.Error.WriteLine(error);
                }
                return 2;
            }

            var runtime = DesktopRuntimeSelfTest.Run();
            if (!runtime.Success)
            {
                foreach (var error in runtime.Errors) Console.Error.WriteLine(error);
                return 3;
            }

            Console.WriteLine($"PokeFolio Desktop self-test passed ({result.AssetCount} shared assets; {string.Join(", ", runtime.Checks)}).\n");
            return 0;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
        return 0;
    }
}

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

            Console.WriteLine($"PokeFolio Desktop self-test passed ({result.AssetCount} shared assets).\n");
            return 0;
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
        return 0;
    }
}

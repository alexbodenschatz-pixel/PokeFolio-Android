using Microsoft.AspNetCore.Mvc;

namespace PokeFolio.Api.Security;

public static class ApiProblemWriter
{
    public static Task WriteAsync(
        HttpResponse response,
        int status,
        string code,
        string title,
        CancellationToken cancellationToken)
    {
        response.StatusCode = status;
        return response.WriteAsJsonAsync(
            new ProblemDetails
            {
                Status = status,
                Title = title,
                Extensions = { ["code"] = code }
            },
            options: null,
            contentType: "application/problem+json",
            cancellationToken);
    }
}

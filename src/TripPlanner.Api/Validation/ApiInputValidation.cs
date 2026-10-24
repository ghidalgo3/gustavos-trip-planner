using System.Collections;
using System.ComponentModel.DataAnnotations;
using System.Reflection;
using System.Text.Json;

namespace TripPlanner.Api.Validation;

// Shared by HTTP endpoint filters and MCP tool invocation. Validation is pure and
// runs before handlers can write to the database or queue provider work.
public static class ApiInputValidation
{
    public static EndpointFilterDelegate CreateFilter(
        EndpointFilterFactoryContext factory,
        EndpointFilterDelegate next
    ) =>
        async context =>
        {
            var errors = new Dictionary<string, string[]>();
            var parameters = factory.MethodInfo.GetParameters();
            for (int i = 0; i < parameters.Length; i++)
            {
                var parameter = parameters[i];
                object? value = context.Arguments[i];
                ValidateAttributes(value, ParameterAttributes(parameter), parameter.Name!, errors);
                if (IsInputType(parameter.ParameterType))
                {
                    Visit(value, parameter.Name!, errors);
                }
            }
            return errors.Count == 0 ? await next(context) : Results.ValidationProblem(errors);
        };

    public static Dictionary<string, string[]> Validate(object? value, string path)
    {
        var errors = new Dictionary<string, string[]>();
        Visit(value, path, errors);
        return errors;
    }

    public static IEnumerable<ValidationAttribute> ParameterAttributes(ParameterInfo parameter)
    {
        var declared = parameter.GetCustomAttributes<ValidationAttribute>().ToArray();
        foreach (var attribute in declared)
        {
            yield return attribute;
        }

        if (
            parameter.ParameterType != typeof(string)
            || parameter.Name
                is not ("destinationCity" or "destinationId" or "contextVersion" or "etag")
        )
        {
            yield break;
        }

        if (!declared.OfType<StringLengthAttribute>().Any())
        {
            yield return new StringLengthAttribute(parameter.Name == "etag" ? 32 : 200)
            {
                MinimumLength = 1,
            };
        }

        if (
            new NullabilityInfoContext().Create(parameter).ReadState == NullabilityState.NotNull
            && !declared.OfType<RequiredAttribute>().Any()
        )
        {
            yield return new RequiredAttribute();
        }

        if (parameter.Name == "etag" && !declared.OfType<RegularExpressionAttribute>().Any())
        {
            yield return new RegularExpressionAttribute("^\"[0-9]{1,19}\"$");
        }
    }

    public static void ValidateAttributes(
        object? value,
        IEnumerable<ValidationAttribute> attributes,
        string path,
        Dictionary<string, string[]> errors
    )
    {
        foreach (var attribute in attributes)
        {
            if (!attribute.IsValid(value))
            {
                errors[path] = [attribute.FormatErrorMessage(path)];
            }
        }
    }

    private static bool IsInputType(Type type) =>
        type == typeof(Guid)
        || type == typeof(Guid?)
        || type.Namespace is "TripPlanner.Api.DTO" or "TripPlanner.Api.Models";

    private static void Visit(
        object? value,
        string path,
        Dictionary<string, string[]> errors,
        int depth = 0,
        bool allowNullItems = false
    )
    {
        if (value is null)
        {
            return;
        }

        if (depth > 32)
        {
            errors[path] = ["Input nesting cannot exceed 32 levels."];
            return;
        }
        if (value is Guid id)
        {
            if (id == Guid.Empty)
            {
                errors[path] = ["Use a nonempty UUID."];
            }

            return;
        }
        if (value is DateOnly date)
        {
            if (date.Year is < 2000 or > 2100)
            {
                errors[path] = ["Dates must be within 2000–2100."];
            }

            return;
        }
        if (value is Enum enumeration)
        {
            if (!Enum.IsDefined(enumeration.GetType(), enumeration))
            {
                errors[path] = ["Use a defined enum value."];
            }

            return;
        }
        if (
            value is string
            || value is JsonElement
            || value.GetType().IsPrimitive
            || value is decimal
        )
        {
            return;
        }

        if (value is IEnumerable collection)
        {
            int index = 0;
            foreach (var item in collection)
            {
                string itemPath = $"{path}[{index++}]";
                if (item is null && !allowNullItems)
                {
                    errors[itemPath] = ["Array items cannot be null."];
                }
                else
                {
                    Visit(item, itemPath, errors, depth + 1);
                }
            }
            return;
        }
        if (!IsInputType(value.GetType()))
        {
            return;
        }

        foreach (
            var property in value
                .GetType()
                .GetProperties(BindingFlags.Instance | BindingFlags.Public)
        )
        {
            if (property.GetIndexParameters().Length != 0 || property.GetMethod is null)
            {
                continue;
            }

            object? member = property.GetValue(value);
            string memberPath =
                path
                + "."
                + (
                    property
                        .GetCustomAttribute<System.Text.Json.Serialization.JsonPropertyNameAttribute>()
                        ?.Name
                    ?? JsonNamingPolicy.CamelCase.ConvertName(property.Name)
                );
            if (
                member is null
                && new NullabilityInfoContext().Create(property).ReadState
                    == NullabilityState.NotNull
            )
            {
                errors[memberPath] = ["This field cannot be null."];
            }

            ValidateAttributes(
                member,
                property.GetCustomAttributes<ValidationAttribute>(),
                memberPath,
                errors
            );
            if (!errors.ContainsKey(memberPath))
            {
                Visit(
                    member,
                    memberPath,
                    errors,
                    depth + 1,
                    property
                        .GetCustomAttribute<TripPlanner.Api.DTO.StringItemsAttribute>()
                        ?.AllowNullItems == true
                );
            }
        }
    }
}

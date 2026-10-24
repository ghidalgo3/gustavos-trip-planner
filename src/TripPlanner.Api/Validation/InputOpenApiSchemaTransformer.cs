using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;
using TripPlanner.Api.DTO;

namespace TripPlanner.Api.Validation;

// Standard range/length/regex attributes are handled by ASP.NET Core. Extend
// its schema generation for the same custom/string-enum attributes used by MCP.
public sealed class InputOpenApiSchemaTransformer : IOpenApiSchemaTransformer
{
    public Task TransformAsync(
        OpenApiSchema schema,
        OpenApiSchemaTransformerContext context,
        CancellationToken cancellationToken
    )
    {
        // Property converters can bypass the per-property callback. Describe their
        // wire representation from the containing resource's metadata as well.
        foreach (var property in context.JsonTypeInfo.Properties)
        {
            var declared = property.AttributeProvider?.GetCustomAttributes(true) ?? [];
            if (schema.Properties is null || !schema.Properties.ContainsKey(property.Name))
            {
                continue;
            }
            if (declared.OfType<ClockTimeAttribute>().Any())
            {
                schema.Properties[property.Name] = new OpenApiSchema
                {
                    Type =
                        JsonSchemaType.String
                        | (property.PropertyType == typeof(TimeOnly?) ? JsonSchemaType.Null : 0),
                    Pattern = ClockTimeAttribute.Pattern,
                    MinLength = 8,
                    MaxLength = 16,
                    Description =
                        "ISO 8601 local time (HH:mm:ss), with zero seconds and no UTC offset.",
                };
            }
            if (
                declared
                    .OfType<System.Text.Json.Serialization.JsonConverterAttribute>()
                    .Any(a => a.ConverterType == typeof(Serialization.IsoDurationConverter))
            )
            {
                var range = declared.OfType<DurationRangeAttribute>().FirstOrDefault();
                schema.Properties[property.Name] = new OpenApiSchema
                {
                    Type =
                        JsonSchemaType.String
                        | (property.PropertyType == typeof(TimeSpan?) ? JsonSchemaType.Null : 0),
                    Format = "duration",
                    Pattern = Serialization.IsoDurationConverter.Pattern,
                    Description =
                        range?.SchemaDescription
                        ?? "ISO 8601 elapsed duration, for example PT1H30M.",
                };
            }
            if (
                declared
                    .OfType<System.Text.Json.Serialization.JsonConverterAttribute>()
                    .Any(a => a.ConverterType == typeof(Serialization.CoordinatesConverter))
            )
            {
                schema.Properties[property.Name] = new OpenApiSchema
                {
                    Type =
                        JsonSchemaType.Array | (property.IsGetNullable ? JsonSchemaType.Null : 0),
                    MinItems = 2,
                    MaxItems = 2,
                    Description =
                        "Exactly [longitude (-180–180), latitude (-90–90)]; both numbers must be finite.",
                    Items = new OpenApiSchema
                    {
                        Type = JsonSchemaType.Number,
                        Minimum = "-180",
                        Maximum = "180",
                    },
                };
            }
        }
        if (context.JsonTypeInfo.Type.IsEnum)
        {
            schema.Type = JsonSchemaType.String;
            schema.Enum = Enum.GetNames(context.JsonTypeInfo.Type)
                .Select(name => JsonSerializer.SerializeToNode(name)!)
                .ToList();
        }
        var attributes =
            context
                .JsonPropertyInfo?.AttributeProvider?.GetCustomAttributes(true)
                .OfType<ValidationAttribute>()
                .ToArray()
            ?? [];
        if (attributes.OfType<ClockTimeAttribute>().Any())
        {
            schema.Type =
                JsonSchemaType.String
                | (context.JsonTypeInfo.Type == typeof(TimeOnly?) ? JsonSchemaType.Null : 0);
            schema.Format = null;
            schema.Pattern = ClockTimeAttribute.Pattern;
            schema.MinLength = 8;
            schema.MaxLength = 16;
        }
        if (
            context.JsonTypeInfo.Type == typeof(TimeSpan)
            || context.JsonTypeInfo.Type == typeof(TimeSpan?)
        )
        {
            schema.Type =
                JsonSchemaType.String
                | (context.JsonTypeInfo.Type == typeof(TimeSpan?) ? JsonSchemaType.Null : 0);
            schema.Format = "duration";
            schema.Pattern = Serialization.IsoDurationConverter.Pattern;
            schema.Description = "ISO 8601 elapsed duration, for example PT1H30M.";
        }
        if (attributes.OfType<DurationRangeAttribute>().FirstOrDefault() is { } duration)
        {
            schema.Description = duration.SchemaDescription;
        }
        if (attributes.OfType<AllowedValuesAttribute>().FirstOrDefault() is { } choices)
        {
            schema.Enum = choices
                .Values.Select(value => JsonSerializer.SerializeToNode(value)!)
                .ToList();
        }

        if (attributes.OfType<CoordinatesAttribute>().Any())
        {
            schema.Type = JsonSchemaType.Array;
            schema.MinItems = schema.MaxItems = 2;
            schema.Description =
                "Exactly [longitude (-180–180), latitude (-90–90)]; both numbers must be finite.";
            schema.Items = new OpenApiSchema
            {
                Type = JsonSchemaType.Number,
                Minimum = "-180",
                Maximum = "180",
            };
        }
        if (attributes.OfType<HttpUrlAttribute>().Any())
        {
            schema.Format = "uri";
            schema.Pattern = HttpUrlAttribute.Pattern;
        }
        if (
            attributes.OfType<SupportedDateAttribute>().Any()
            || context.JsonTypeInfo.Type == typeof(DateOnly)
            || context.JsonTypeInfo.Type == typeof(DateOnly?)
        )
        {
            schema.Format = "date";
            schema.Description = "ISO 8601 date (YYYY-MM-DD), within 2000–2100.";
        }
        if (attributes.OfType<TimeZoneIdAttribute>().Any())
        {
            schema.Description =
                "Recognized time zone ID, e.g. Europe/Paris. Omit it when unknown.";
        }

        if (attributes.OfType<JsonObjectValueAttribute>().Any())
        {
            schema.Type =
                JsonSchemaType.Object
                | (context.JsonTypeInfo.Type == typeof(JsonElement?) ? JsonSchemaType.Null : 0);
            schema.AdditionalPropertiesAllowed = true;
        }
        if (attributes.OfType<StringItemsAttribute>().FirstOrDefault() is { } items)
        {
            schema.Items = new OpenApiSchema
            {
                Type = JsonSchemaType.String | (items.AllowNullItems ? JsonSchemaType.Null : 0),
                MinLength = 1,
                MaxLength = items.MaxLength,
                Pattern = items.Pattern,
            };
        }

        if (attributes.OfType<DestinationConstraintsAttribute>().Any())
        {
            schema.Properties = new Dictionary<string, IOpenApiSchema>
            {
                ["arrivalFlexibilityDays"] = new OpenApiSchema
                {
                    Type = JsonSchemaType.Integer,
                    Minimum = "0",
                    Maximum = DestinationConstraintsAttribute.MaxFlexibilityDays.ToString(
                        System.Globalization.CultureInfo.InvariantCulture
                    ),
                },
                ["departureFlexibilityDays"] = new OpenApiSchema
                {
                    Type = JsonSchemaType.Integer,
                    Minimum = "0",
                    Maximum = DestinationConstraintsAttribute.MaxFlexibilityDays.ToString(
                        System.Globalization.CultureInfo.InvariantCulture
                    ),
                },
                ["keepAfterPrevious"] = new OpenApiSchema { Type = JsonSchemaType.Boolean },
            };
        }

        return Task.CompletedTask;
    }
}

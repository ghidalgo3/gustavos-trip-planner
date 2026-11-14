using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.OpenApi;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Instructions;

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
                    Description = McpInstructions.Schema.ClockTime,
                };
            }
            if (declared.OfType<TransportationCoordinatesAttribute>().Any())
            {
                var point = new OpenApiSchema
                {
                    Type = JsonSchemaType.Array,
                    MinItems = 2,
                    MaxItems = 2,
                    Items = new OpenApiSchema
                    {
                        Type = JsonSchemaType.Number,
                        Minimum = "-180",
                        Maximum = "180",
                    },
                };
                var line = new OpenApiSchema
                {
                    Type = JsonSchemaType.Array,
                    MinItems = 2,
                    MaxItems = 10000,
                    Items = point,
                };
                var multi = new OpenApiSchema
                {
                    Type = JsonSchemaType.Array,
                    MinItems = 1,
                    MaxItems = 100,
                    Items = line,
                };
                schema.Properties[property.Name] = new OpenApiSchema
                {
                    OneOf = [point, line, multi],
                    Description = TransportationCoordinatesAttribute.SchemaDescription,
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
                    Description = range?.SchemaDescription ?? McpInstructions.Schema.Duration,
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
                    Description = McpInstructions.Schema.Coordinates,
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
            schema.Description = McpInstructions.Schema.Duration;
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
            schema.Description = McpInstructions.Schema.Coordinates;
            schema.Items = new OpenApiSchema
            {
                Type = JsonSchemaType.Number,
                Minimum = "-180",
                Maximum = "180",
            };
        }
        if (attributes.OfType<UniqueItemsAttribute>().Any())
        {
            schema.UniqueItems = true;
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
            schema.Description = McpInstructions.Schema.Date;
        }
        if (attributes.OfType<TimeZoneIdAttribute>().Any())
        {
            schema.Description = McpInstructions.Schema.TimeZone;
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

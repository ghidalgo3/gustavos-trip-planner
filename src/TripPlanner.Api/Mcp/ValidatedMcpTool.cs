using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using Microsoft.Extensions.AI;
using ModelContextProtocol.Protocol;
using ModelContextProtocol.Server;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Instructions;
using TripPlanner.Api.Models;
using TripPlanner.Api.Serialization;
using TripPlanner.Api.Telemetry;
using TripPlanner.Api.Validation;

namespace TripPlanner.Api.Mcp;

public sealed class ValidatedMcpTool(McpServerTool inner, MethodInfo method)
    : DelegatingMcpServerTool(inner)
{
    private static readonly JsonSerializerOptions SerializerOptions = new(
        JsonSerializerDefaults.Web
    )
    {
        TypeInfoResolver = new DefaultJsonTypeInfoResolver(),
        Converters =
        {
            new IsoTimeOnlyConverter(),
            new IsoDurationConverter(),
            new StringEnumConverter<ActivityState>(),
            new StringEnumConverter<PartyRole>(),
            new JsonStringEnumConverter(allowIntegerValues: false),
        },
    };

    private static readonly MethodInfo[] ToolMethods = new[]
    {
        typeof(TripPlannerTools),
        typeof(TransportationTools),
        typeof(ActivityPlanningTools),
        typeof(PlanningContextTools),
    }
        .SelectMany(type => type.GetMethods())
        .Where(method => method.IsDefined(typeof(McpServerToolAttribute)))
        .ToArray();

    public static bool IsKnownTool(string? name) =>
        ToolMethods.Any(method =>
            method.GetCustomAttribute<McpServerToolAttribute>()?.Name == name
        );

    public static IEnumerable<McpServerTool> CreateTools() =>
        ToolMethods.Select(method => new ValidatedMcpTool(
            McpServerTool.Create(
                method,
                context =>
                    ActivatorUtilities.CreateInstance(context.Services!, method.DeclaringType!),
                new McpServerToolCreateOptions
                {
                    SerializerOptions = SerializerOptions,
                    SchemaCreateOptions = new() { TransformSchemaNode = TransformSchema },
                }
            ),
            method
        ));

    public override ValueTask<CallToolResult> InvokeAsync(
        RequestContext<CallToolRequestParams> request,
        CancellationToken cancellationToken = default
    ) =>
        OperationTelemetry.TraceToolAsync(
            method.GetCustomAttribute<McpServerToolAttribute>()?.Name ?? method.Name,
            () => InvokeValidatedAsync(request, cancellationToken),
            cancellationToken
        );

    private ValueTask<CallToolResult> InvokeValidatedAsync(
        RequestContext<CallToolRequestParams> request,
        CancellationToken cancellationToken
    )
    {
        var errors = new Dictionary<string, string[]>();
        foreach (var parameter in method.GetParameters())
        {
            if (request.Params?.Arguments?.TryGetValue(parameter.Name!, out var json) != true)
            {
                if (!parameter.HasDefaultValue)
                {
                    errors[parameter.Name!] = [McpInstructions.Messages.RequiredParameter];
                }

                continue;
            }
            try
            {
                object? value = json.Deserialize(parameter.ParameterType, SerializerOptions);
                if (
                    value is null
                    && new NullabilityInfoContext().Create(parameter).ReadState
                        == NullabilityState.NotNull
                )
                {
                    errors[parameter.Name!] = [McpInstructions.Messages.NullParameter];
                }

                ApiInputValidation.ValidateAttributes(
                    value,
                    ApiInputValidation.ParameterAttributes(parameter),
                    parameter.Name!,
                    errors
                );
                foreach (var error in ApiInputValidation.Validate(value, parameter.Name!))
                {
                    errors[error.Key] = error.Value;
                }
            }
            catch (JsonException)
            {
                errors[parameter.Name!] = [McpInstructions.Messages.InvalidParameterFormat];
            }
        }
        return errors.Count == 0
            ? base.InvokeAsync(request, cancellationToken)
            : ValueTask.FromResult(
                new CallToolResult
                {
                    IsError = true,
                    StructuredContent = JsonSerializer.SerializeToElement(
                        new { status = 400, errors }
                    ),
                    Content =
                    [
                        new TextContentBlock
                        {
                            Text = JsonSerializer.Serialize(new { status = 400, errors }),
                        },
                    ],
                }
            );
    }

    private static JsonNode TransformSchema(AIJsonSchemaCreateContext context, JsonNode schema)
    {
        if (context.TypeInfo.Type.IsEnum)
        {
            var enumSchema = new JsonObject
            {
                ["type"] = "string",
                ["enum"] = JsonSerializer.SerializeToNode(Enum.GetNames(context.TypeInfo.Type)),
            };
            if (context.GetCustomAttribute<DescriptionAttribute>() is { } description)
            {
                enumSchema["description"] = description.Description;
            }
            return enumSchema;
        }
        // JsonElement exports as the boolean schema `true`, not an object.
        // Materialize it before attaching the DTO's object/field constraints.
        JsonObject node;
        if (schema is JsonObject objectSchema)
        {
            node = objectSchema;
        }
        else if (
            schema is JsonValue value
            && value.TryGetValue<bool>(out bool anyValue)
            && anyValue
        )
        {
            node = new JsonObject();
        }
        else
        {
            return schema;
        }

        T? Attribute<T>()
            where T : ValidationAttribute =>
            context.GetCustomAttribute<T>()
            ?? (
                context.ParameterAttributeProvider is ParameterInfo parameter
                    ? ApiInputValidation.ParameterAttributes(parameter).OfType<T>().FirstOrDefault()
                    : null
            );
        if (context.TypeInfo.Type == typeof(TimeSpan) || context.TypeInfo.Type == typeof(TimeSpan?))
        {
            node.Clear();
            node["type"] =
                context.TypeInfo.Type == typeof(TimeSpan?)
                    ? new JsonArray("string", "null")
                    : JsonValue.Create("string");
            node["format"] = "duration";
            node["pattern"] = IsoDurationConverter.Pattern;
            node["description"] = McpInstructions.Schema.Duration;
        }
        if (Attribute<DurationRangeAttribute>() is { } duration)
        {
            node["description"] = duration.SchemaDescription;
        }
        if (Attribute<ClockTimeAttribute>() is not null)
        {
            node = ClockTimeSchema(context.TypeInfo.Type);
        }
        if (Attribute<AllowedValuesAttribute>() is { } choices)
        {
            node["enum"] = JsonSerializer.SerializeToNode(choices.Values);
        }

        if (Attribute<StringLengthAttribute>() is { } text)
        {
            node["minLength"] = text.MinimumLength;
            node["maxLength"] = text.MaximumLength;
        }
        if (Attribute<RangeAttribute>() is { } range)
        {
            node["minimum"] = Convert.ToDecimal(range.Minimum, CultureInfo.InvariantCulture);
            node["maximum"] = Convert.ToDecimal(range.Maximum, CultureInfo.InvariantCulture);
        }
        if (Attribute<RegularExpressionAttribute>() is { } pattern)
        {
            node["pattern"] = pattern.Pattern;
        }

        if (Attribute<MaxLengthAttribute>() is { } max)
        {
            node["maxItems"] = max.Length;
        }

        if (Attribute<MinLengthAttribute>() is { } min)
        {
            node["minItems"] = min.Length;
        }

        if (context.GetCustomAttribute<StringItemsAttribute>() is { } items)
        {
            node["items"] = new JsonObject
            {
                ["type"] = items.AllowNullItems
                    ? new JsonArray("string", "null")
                    : JsonValue.Create("string"),
                ["minLength"] = 1,
                ["maxLength"] = items.MaxLength,
                ["pattern"] = items.Pattern,
            };
        }

        if (context.GetCustomAttribute<UniqueItemsAttribute>() is not null)
        {
            node["uniqueItems"] = true;
        }

        if (context.GetCustomAttribute<HttpUrlAttribute>() is not null)
        {
            node["format"] = "uri";
            node["pattern"] = HttpUrlAttribute.Pattern;
        }
        if (
            context.GetCustomAttribute<SupportedDateAttribute>() is not null
            || context.TypeInfo.Type == typeof(DateOnly)
            || context.TypeInfo.Type == typeof(DateOnly?)
        )
        {
            node["format"] = "date";
            node["description"] = McpInstructions.Schema.Date;
        }
        if (context.GetCustomAttribute<TimeZoneIdAttribute>() is not null)
        {
            node["description"] = McpInstructions.Schema.TimeZone;
        }
        // Converter-backed JsonElement properties can bypass the SDK's per-property
        // callback. Apply their declared contracts from the containing type too.
        if (node["properties"] is JsonObject properties)
        {
            if (
                context.TypeInfo.Type == typeof(ActivityProperties)
                && properties["locationVerification"] is JsonObject verification
            )
            {
                var required = node["required"] as JsonArray;
                if (required is null)
                {
                    required = [];
                    node["required"] = required;
                }
                required.Add("locationVerification");
                verification["type"] = "object";
                verification.Remove("default");
            }

            foreach (var property in context.TypeInfo.Properties)
            {
                var declared = property.AttributeProvider?.GetCustomAttributes(true) ?? [];
                if (declared.OfType<ClockTimeAttribute>().Any())
                {
                    properties[property.Name] = ClockTimeSchema(property.PropertyType);
                }
                if (
                    declared
                        .OfType<JsonConverterAttribute>()
                        .Any(a => a.ConverterType == typeof(IsoDurationConverter))
                )
                {
                    var durationNode = new JsonObject
                    {
                        ["type"] =
                            property.PropertyType == typeof(TimeSpan?)
                                ? new JsonArray("string", "null")
                                : JsonValue.Create("string"),
                        ["format"] = "duration",
                        ["pattern"] = IsoDurationConverter.Pattern,
                        ["description"] = McpInstructions.Schema.Duration,
                    };
                    if (
                        declared.OfType<DurationRangeAttribute>().FirstOrDefault() is
                        { } durationRange
                    )
                    {
                        durationNode["description"] = durationRange.SchemaDescription;
                    }
                    properties[property.Name] = durationNode;
                }
                if (
                    declared
                        .OfType<JsonConverterAttribute>()
                        .Any(a => a.ConverterType == typeof(CoordinatesConverter))
                )
                {
                    properties[property.Name] = new JsonObject
                    {
                        ["type"] = property.IsGetNullable
                            ? new JsonArray("array", "null")
                            : JsonValue.Create("array"),
                        ["minItems"] = 2,
                        ["maxItems"] = 2,
                        ["prefixItems"] = new JsonArray(
                            new JsonObject
                            {
                                ["type"] = "number",
                                ["minimum"] = -180,
                                ["maximum"] = 180,
                            },
                            new JsonObject
                            {
                                ["type"] = "number",
                                ["minimum"] = -90,
                                ["maximum"] = 90,
                            }
                        ),
                        ["items"] = false,
                    };
                }
                var rule = property
                    .AttributeProvider?.GetCustomAttributes(true)
                    .OfType<JsonObjectValueAttribute>()
                    .FirstOrDefault();
                if (rule is null || !properties.ContainsKey(property.Name))
                {
                    continue;
                }

                var child = properties[property.Name] as JsonObject;
                if (child is null)
                {
                    properties[property.Name] = child = new JsonObject();
                }

                ApplyObjectRules(child, property.PropertyType, rule);
            }
        }
        if (context.GetCustomAttribute<JsonObjectValueAttribute>() is { } objectRule)
        {
            ApplyObjectRules(node, context.TypeInfo.Type, objectRule);
        }

        if (context.GetCustomAttribute<TransportationCoordinatesAttribute>() is not null)
        {
            return TransportationCoordinatesAttribute.CreateSchema();
        }
        if (node["properties"] is JsonObject fields)
        {
            foreach (var property in context.TypeInfo.Properties)
            {
                if (
                    property
                        .AttributeProvider?.GetCustomAttributes(
                            typeof(TransportationCoordinatesAttribute),
                            true
                        )
                        .Length > 0
                )
                {
                    fields[property.Name] = TransportationCoordinatesAttribute.CreateSchema();
                }
            }
        }

        if (context.GetCustomAttribute<CoordinatesAttribute>() is not null)
        {
            node["type"] = "array";
            node["minItems"] = 2;
            node["maxItems"] = 2;
            node["prefixItems"] = new JsonArray(
                new JsonObject
                {
                    ["type"] = "number",
                    ["minimum"] = -180,
                    ["maximum"] = 180,
                },
                new JsonObject
                {
                    ["type"] = "number",
                    ["minimum"] = -90,
                    ["maximum"] = 90,
                }
            );
            node["items"] = false;
        }
        return node;
    }

    private static JsonObject ClockTimeSchema(Type type) =>
        new()
        {
            ["type"] =
                type == typeof(TimeOnly?)
                    ? new JsonArray("string", "null")
                    : JsonValue.Create("string"),
            ["pattern"] = ClockTimeAttribute.Pattern,
            ["minLength"] = 8,
            ["maxLength"] = 16,
            ["description"] = McpInstructions.Schema.ClockTime,
        };

    private static void ApplyObjectRules(JsonObject node, Type type, JsonObjectValueAttribute rule)
    {
        node["type"] =
            type == typeof(JsonElement?)
                ? new JsonArray("object", "null")
                : JsonValue.Create("object");
        node["additionalProperties"] = true;
        if (rule is DestinationConstraintsAttribute)
        {
            node["properties"] = new JsonObject
            {
                ["arrivalFlexibilityDays"] = new JsonObject
                {
                    ["type"] = "integer",
                    ["minimum"] = 0,
                    ["maximum"] = DestinationConstraintsAttribute.MaxFlexibilityDays,
                },
                ["departureFlexibilityDays"] = new JsonObject
                {
                    ["type"] = "integer",
                    ["minimum"] = 0,
                    ["maximum"] = DestinationConstraintsAttribute.MaxFlexibilityDays,
                },
                ["keepAfterPrevious"] = new JsonObject { ["type"] = "boolean" },
            };
        }
    }
}

# Scheduling authorization matrix

This matrix reflects the current Admin and Receptionist scheduling workspaces. `R` is read, `C` create, `U` update, `D` delete, and `S` status change.

| Area | Admin | Receptionist | Doctor | Enforcement |
| --- | --- | --- | --- | --- |
| Appointments | R/C/U/D/S | R/C/U/S | R/C/U/S | Delete remains Admin-only; create/update/status remain clinical staff |
| Working hours | R/U | R/U | R | Update restricted to Admin/Receptionist |
| Doctor schedules | R/U/D | R/U/D | R/U/D (self) | Doctors can mutate only their own schedule; Admin/Receptionist can manage any Doctor |
| Special days | R/C/D | R/C/D | R | Mutations restricted to Admin/Receptionist |
| Doctor block time | R/C/D | R/C/D | R/C/D (self) | Doctors can mutate only their own blocks; Admin/Receptionist can manage any Doctor |
| Booking settings | R/U | R/U | R | Update restricted to Admin/Receptionist |
| Appointment import | C | C | - | Restricted to Admin/Receptionist |

Doctors retain scoped clinical appointment workflows and may manage only their own schedule and block time. They cannot mutate clinic-wide working hours, special days, booking settings, imports, another Doctor's schedule, or delete appointments. Receptionist access is retained because both the Admin and Receptionist pages render the shared scheduling settings components.

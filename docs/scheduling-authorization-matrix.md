# Scheduling authorization matrix

This matrix reflects the current Admin and Receptionist scheduling workspaces. `R` is read, `C` create, `U` update, `D` delete, and `S` status change.

| Area | Admin | Receptionist | Doctor | Enforcement |
| --- | --- | --- | --- | --- |
| Appointments | R/C/U/D/S | R/C/U/D/S | R/C/U/S | Delete restricted to Admin/Receptionist; create/update/status remain clinical staff |
| Working hours | R/U | R/U | R | Update restricted to Admin/Receptionist |
| Doctor schedules | R/U/D | R/U/D | R | Mutations restricted to Admin/Receptionist |
| Special days | R/C/D | R/C/D | R | Mutations restricted to Admin/Receptionist |
| Doctor block time | R/C/D | R/C/D | R | Mutations restricted to Admin/Receptionist |
| Booking settings | R/U | R/U | R | Update restricted to Admin/Receptionist |
| Appointment import | C | C | - | Restricted to Admin/Receptionist |

Doctors retain clinical appointment workflows but cannot mutate clinic-wide configuration or delete appointments. Receptionist access is retained because both the Admin and Receptionist pages render the shared scheduling settings components.
